import type { Request, Response } from "express";
import type { AuthRequest } from "../middleware/authMiddleware.ts";
import Hospital from "../model/Hospital.ts";
import GPO from "../model/Gpo.ts";
import IDN from "../model/Idn.ts";
import fs from "fs";
import path from "path";
import mongoose from "mongoose";
import Deal from "../model/deal.ts";
import Contact from "../model/Contact.ts";
import { UserRole } from "../model/User.ts";
import DocumentModel from "../model/Document.ts";
import Notes from "../model/Notes.ts";
import CallLogs from "../model/CallLogs.ts";
import Task from "../model/Task.ts";
import { buildFieldWordSearchCondition } from "../helper/searchHelper.ts";

export const getHospitals = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const search = (req.query.search as string) || "";
    const idn = req.query.idn as string;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;

    // Build match stage
    const matchStage: any = {};

    if (search.trim()) {
      const hospitalNameCond = buildFieldWordSearchCondition("hospitalName", search);
      const cityCond = buildFieldWordSearchCondition("city", search);
      matchStage.$or = [hospitalNameCond, cityCond].filter(Boolean);
    }

    if (idn && mongoose.Types.ObjectId.isValid(idn)) {
      matchStage.idn = new mongoose.Types.ObjectId(idn);
    }

    const pipeline: any[] = [
      { $match: matchStage },
      { $sort: { createdAt: -1 } },
      {
        $lookup: {
          from: "idns",
          localField: "idn",
          foreignField: "_id",
          as: "idn",
        },
      },
      { $unwind: { path: "$idn", preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: "gpos",
          localField: "gpo",
          foreignField: "_id",
          as: "gpo",
        },
      },
      { $unwind: { path: "$gpo", preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: "contacts",
          localField: "_id",
          foreignField: "hospital",
          as: "contacts",
        },
      },
      {
        $project: {
          hospitalName: 1,
          city: 1,
          idn: { _id: 1, name: 1 },
          gpo: { _id: 1, name: 1 },
          contacts: {
            _id: 1,
            firstName: 1,
            lastName: 1,
            email: 1,
            phoneNumber: 1,
            designation: 1,
            isPrimary: 1,
          },
          createdAt: 1,
        },
      },
      {
        $facet: {
          data: [{ $skip: skip }, { $limit: limit }],
          totalCount: [{ $count: "total" }],
        },
      },
    ];

    const result = await Hospital.aggregate(pipeline);
    const hospitals = result[0]?.data || [];
    const total = result[0]?.totalCount[0]?.total || 0;

    res.status(200).json({
      success: true,
      page,
      limit,
      totalHospitals: total,
      totalPages: Math.ceil(total / limit),
      hasMore: total > skip + hospitals.length,
      data: hospitals,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: "Failed to retrieve hospitals",
      error: error.message,
    });
  }
};

// Sample Test
export const HospitalIDName = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const hospitals = await Hospital.find({}, "_id hospitalName");

    const formattedHospitals = hospitals.reduce(
      (acc: Record<string, string>, hospital: any) => {
        acc[hospital.hospitalName] = hospital._id.toString();
        return acc;
      },
      {},
    );

    res.status(200).json(formattedHospitals);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch hospitals",
      error,
    });
  }
};

export const getHospitalByHospitalId = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { id } = req.params;

    if (typeof id !== "string") {
      res.status(400).json({ success: false, message: "Invalid ID" });
      return;
    }

    // 1. Get hospital
    const hospital = await Hospital.findById(id)
      .populate({
        path: "idn",
        select: "name notes",
        populate: {
          path: "notes.user",
          select: "name",
        },
      })
      .populate("gpo", "name")
      .populate("primaryRep", "name")
      .populate("secondaryRep", "name");

    if (!hospital) {
      res.status(404).json({
        success: false,
        message: "Hospital not found",
      });
      return;
    }

    // 2. Get contacts linked to hospital ✅
    const contacts = await Contact.find({ hospitals: id })
      .select(
        "firstName lastName phoneNumber designation email isPrimary product hospitals",
      )
      .populate("product", "name");

    // 3. Get deals
    const rawDeals = await Deal.find({ hospital: id })
      .select("products user")
      .populate({
        path: "products.product",
        select: "name",
      })
      .populate("user", "name");

    const deals = rawDeals.map((deal: any) => {
      const dealObj = deal.toObject();
      delete dealObj.leadSource;
      delete dealObj.leadSourceDetails;
      return dealObj;
    });

    // Extract all deal products and their beds across every deal
    const productInfo = deals.flatMap((deal: any) =>
      (deal.products || []).map((product: any) => ({
        productName: product.product?.name || "N/A",
        beds: product.beds || 0,
      })),
    );

    const dealBedsTotal = productInfo.reduce((sum, p) => sum + p.beds, 0);
    const icuBeds = hospital.ICUBeds || 0;
    // const totalBeds = icuBeds + dealBedsTotal;
    const totalBeds = hospital.totalBeds || 0;

    // 4. Annotate contacts with isPrimary based on hospital's primaryContacts array
    const primaryContactIds = (hospital.primaryContacts || []).map((id: any) => id.toString());
    if ((hospital as any).primaryContact) {
      primaryContactIds.push((hospital as any).primaryContact.toString());
    }

    const annotatedContacts = contacts.map((c: any) => {
      const contactObj = c.toObject ? c.toObject() : { ...c };
      contactObj.isPrimary = primaryContactIds.includes(contactObj._id.toString());
      return contactObj;
    });

    // 5. Final response
    const responseData = {
      ...hospital.toObject(),
      beds: totalBeds, // ICU beds plus all deal product beds
      productInfo,
      contacts: annotatedContacts, // Contacts with per-hospital isPrimary
      deals,
    };

    res.status(200).json({
      success: true,
      data: responseData,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: "Error fetching hospital",
      error: error.message,
    });
  }
};

export const togglePrimaryContact = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const { id } = req.params;
    const { contactId } = req.body;

    const hospitalIdStr = typeof id === "string" ? id : "";
    const contactIdStr = typeof contactId === "string" ? contactId : "";

    if (!hospitalIdStr || !mongoose.Types.ObjectId.isValid(hospitalIdStr)) {
      res.status(400).json({ success: false, message: "Invalid hospital ID" });
      return;
    }

    if (!contactIdStr || !mongoose.Types.ObjectId.isValid(contactIdStr)) {
      res.status(400).json({ success: false, message: "Invalid contact ID" });
      return;
    }

    const hospital = await Hospital.findById(hospitalIdStr);
    if (!hospital) {
      res.status(404).json({ success: false, message: "Hospital not found" });
      return;
    }

    if (!hospital.primaryContacts) {
      hospital.primaryContacts = [];
    }

    const primaryIdsStr = hospital.primaryContacts.map((cId: any) => cId.toString());
    const isCurrentlyPrimary = primaryIdsStr.includes(contactIdStr);

    if (isCurrentlyPrimary) {
      hospital.primaryContacts = hospital.primaryContacts.filter(
        (cId: any) => cId.toString() !== contactIdStr
      );
      if ((hospital as any).primaryContact?.toString() === contactIdStr) {
        (hospital as any).primaryContact = null;
      }
    } else {
      hospital.primaryContacts.push(new mongoose.Types.ObjectId(contactIdStr));
    }

    await hospital.save();

    res.status(200).json({
      success: true,
      message: !isCurrentlyPrimary
        ? "Primary contact added successfully"
        : "Primary contact removed successfully",
      data: { primaryContacts: hospital.primaryContacts },
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: "Failed to toggle primary contact",
      error: error.message,
    });
  }
};

export const createHospital = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const hospitalData = Object.fromEntries(
      Object.entries(req.body).filter(([, v]) => v !== undefined && v !== ""),
    );

    if (
      hospitalData.primaryRep &&
      hospitalData.secondaryRep &&
      hospitalData.primaryRep.toString() === hospitalData.secondaryRep.toString()
    ) {
      res.status(400).json({
        success: false,
        message: "Primary representative and Secondary representative cannot be the same user",
      });
      return;
    }

    const hospital = new Hospital(hospitalData);
    await hospital.save();

    if (hospital.gpo) {
      await GPO.findByIdAndUpdate(hospital.gpo, {
        $addToSet: { hospitals: hospital._id },
      });
    }

    if (hospital.idn) {
      await IDN.findByIdAndUpdate(hospital.idn, {
        $addToSet: { hospitals: hospital._id },
      });
    }

    res.status(201).json({
      success: true,
      data: hospital,
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: "Failed to create hospital",
      error: error.message,
    });
  }
};

export const deleteHospital = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { id } = req.params;

    if (typeof id !== "string") {
      res.status(400).json({ success: false, message: "Invalid ID" });
      return;
    }

    const hospital = await Hospital.findById(id);

    if (!hospital) {
      res.status(404).json({ success: false, message: "Hospital not found" });
      return;
    }

    if (hospital.gpo) {
      await GPO.findByIdAndUpdate(hospital.gpo, {
        $pull: { hospitals: hospital._id },
      });
    }

    if (hospital.idn) {
      await IDN.findByIdAndUpdate(hospital.idn, {
        $pull: { hospitals: hospital._id },
      });
    }

    // Fetch and delete physical documents from uploads folder
    try {
      const documents = await DocumentModel.find({ hospital: id });
      for (const doc of documents) {
        if (doc.filename) {
          const filePath = path.join("uploads", doc.filename);
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
          }
        }
      }
    } catch (err) {
      console.error("Error unlinking files for hospital:", err);
    }

    // Cascade delete related records
    await Promise.all([
      Deal.deleteMany({ hospital: id }),
      DocumentModel.deleteMany({ hospital: id }),
      Notes.deleteMany({ hospital: id }),
      CallLogs.deleteMany({ hospital: id }),
      Task.deleteMany({ hospital: id }),
    ]);

    await Contact.updateMany({ hospitals: id }, { $pull: { hospitals: id } });
    await Contact.deleteMany({ hospitals: { $size: 0 } });

    await Hospital.findByIdAndDelete(id);

    res.status(200).json({
      success: true,
      message: "Hospital and all related records deleted successfully",
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: "Error deleting hospital",
      error: error.message,
    });
  }
};

export const updateHospital = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const { id } = req.params;

    if (typeof id !== "string") {
      res.status(400).json({ success: false, message: "Invalid ID" });
      return;
    }

    // Fetch existing hospital to check the current assigned user
    const hospital = await Hospital.findById(id);

    if (!hospital) {
      res.status(404).json({ success: false, message: "Hospital not found" });
      return;
    }

    const updateData = Object.fromEntries(
      Object.entries(req.body).filter(([, v]) => v !== undefined && v !== ""),
    );

    const finalPrimaryRep = updateData.primaryRep !== undefined ? updateData.primaryRep : hospital.primaryRep;
    const finalSecondaryRep = updateData.secondaryRep !== undefined ? updateData.secondaryRep : hospital.secondaryRep;

    if (
      finalPrimaryRep &&
      finalSecondaryRep &&
      finalPrimaryRep.toString() !== "" &&
      finalSecondaryRep.toString() !== "" &&
      finalPrimaryRep.toString() !== "null" &&
      finalSecondaryRep.toString() !== "null" &&
      finalPrimaryRep.toString() === finalSecondaryRep.toString()
    ) {
      res.status(400).json({
        success: false,
        message: "Primary representative and Secondary representative cannot be the same user",
      });
      return;
    }

    // Restrict Sales & Clinical Specialist roles from editing certain fields
    if (req.user?.role === UserRole.SALES || req.user?.role === UserRole.CLINICAL_SPECIALIST) {
      // Remove restricted fields if present
      delete updateData.hospitalName;
      delete updateData.idn;
      delete updateData.address;

      // Primary Rep: Sales can only assign themselves if no primary rep is declared
      if (updateData.primaryRep) {
        if (hospital.primaryRep && updateData.primaryRep.toString() === hospital.primaryRep.toString()) {
          // Same value as existing — no change needed, just strip it
          delete updateData.primaryRep;
        } else if (hospital.primaryRep) {
          // Already has a different primary rep — Sales cannot change it
          delete updateData.primaryRep;
          res.status(403).json({
            success: false,
            message: "Only Admin or Executive can change the primary rep once declared",
          });
          return;
        } else if (updateData.primaryRep.toString() !== req.user._id.toString()) {
          // No primary rep, but trying to assign someone else
          delete updateData.primaryRep;
          res.status(403).json({
            success: false,
            message: "Sales can only assign themselves as primary rep",
          });
          return;
        }
      }

      // Secondary Rep: Sales can only assign themselves if no secondary rep is declared
      if (updateData.secondaryRep) {
        if (hospital.secondaryRep && updateData.secondaryRep.toString() === hospital.secondaryRep.toString()) {
          // Same value as existing — no change needed, just strip it
          delete updateData.secondaryRep;
        } else if (hospital.secondaryRep) {
          // Already has a different secondary rep — Sales cannot change it
          delete updateData.secondaryRep;
          res.status(403).json({
            success: false,
            message: "Only Admin or Executive can change the secondary rep once declared",
          });
          return;
        } else if (updateData.secondaryRep.toString() !== req.user._id.toString()) {
          // No secondary rep, but trying to assign someone else
          delete updateData.secondaryRep;
          res.status(403).json({
            success: false,
            message: "Sales can only assign themselves as secondary rep",
          });
          return;
        }
      }
    } else {
      // Non-Sales roles: Admin/Executive primaryRep change check (existing logic)
      if (
        updateData.primaryRep &&
        (!hospital.primaryRep || updateData.primaryRep.toString() !== hospital.primaryRep.toString())
      ) {
        if (
          req.user?.role !== UserRole.ADMIN &&
          req.user?.role !== UserRole.EXECUTIVE
        ) {
          res.status(403).json({
            success: false,
            message:
              "Only Admin or Executive can change the primary rep of a hospital",
          });
          return;
        }
      }
    }

    // 🔥 1. Update hospital
    const updatedHospital = await Hospital.findByIdAndUpdate(id, updateData, {
      new: true,
      runValidators: true,
    })
      .populate("idn", "name")
      .populate("gpo", "name")
      .populate({
        path: "contacts",
        select: "firstName lastName designation phoneNumber email isPrimary product",
        populate: { path: "product", select: "name" },
      });

    if (!updatedHospital) {
      res.status(404).json({ success: false, message: "Hospital not found" });
      return;
    }

    // Reassign all associated deals to the new primary rep
    if (updateData.primaryRep !== undefined) {
      await Deal.updateMany(
        { hospital: id },
        { user: updateData.primaryRep }
      );
    }

    // 🔥 2. Fetch deals for this hospital
    const deals = await Deal.find({ hospital: id })
      .select("_id products")
      .populate("products.product", "name"); // 👈 populate product inside array

    // 🔥 3. Send combined response
    res.status(200).json({
      success: true,
      data: {
        ...updatedHospital.toObject(),
        deals, // 👈 attach deals here
      },
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: "Failed to update hospital",
      error: error.message,
    });
  }
};

export const getHospitalsByIDN = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { idnId } = req.params;

    if (!idnId) {
      res.status(400).json({ message: "IDN ID is required" });
      return;
    }

    const hospitals = await Hospital.find({ idn: idnId })
      .select("_id hospitalName")
      .sort({ hospitalName: 1 });

    res.status(200).json({
      success: true,
      count: hospitals.length,
      data: hospitals,
    });
  } catch (error) {
    console.error("Error fetching hospitals by IDN:", error);
    res.status(500).json({ message: "Server error" });
  }
};

export const getAllHospitalsDeals = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;

    const search = (req.query.search as string) || "";
    const reqUserId = req.query.userId as string;
    const productStage = req.query.productStage as string;

    let filterUserId: mongoose.Types.ObjectId | null = null;
    const isAdminOrExecutiveOrCustomerSuccess =
      req.user?.role === UserRole.ADMIN ||
      req.user?.role === UserRole.EXECUTIVE ||
      req.user?.role === UserRole.CUSTOMER_SUCCESS;

    if (reqUserId && mongoose.Types.ObjectId.isValid(reqUserId)) {
      filterUserId = new mongoose.Types.ObjectId(reqUserId);
    }

    let matchedHospitalIds: mongoose.Types.ObjectId[] = [];

    if (filterUserId) {
      const dealQuery: any = { user: filterUserId };

      if (productStage) {
        dealQuery["products.stage"] = productStage;
      }

      const userDeals = await Deal.find(dealQuery, "hospital").lean();

      matchedHospitalIds = userDeals
        .map((d: any) => d.hospital)
        .filter((id: any) => id != null);
    }

    const pipeline: any[] = [];

    // ================= USER FILTER =================
    if (filterUserId) {
      pipeline.push({
        $match: {
          $or: [{ primaryRep: filterUserId }, { secondaryRep: filterUserId }, { _id: { $in: matchedHospitalIds } }],
        },
      });
    }

    // ================= DEALS LOOKUP =================
    pipeline.push({
      $lookup: {
        from: "deals",
        let: { hospitalId: "$_id" },
        pipeline: [
          {
            $match: {
              $expr: { $eq: ["$hospital", "$$hospitalId"] },
            },
          },

          ...(productStage
            ? [
              {
                $match: {
                  "products.stage": productStage,
                },
              },
            ]
            : []),

          {
            $project: {
              _id: 0,
              products: 1,
              user: 1,
            },
          },
        ],
        as: "deals",
      },
    });

    // ================= REMOVE EMPTY HOSPITALS ONLY WHEN FILTERED =================
    if (productStage) {
      pipeline.push({
        $match: {
          deals: { $ne: [], $exists: true },
        },
      });
    }

    // ================= FLATTEN PRODUCT IDS =================
    pipeline.push({
      $addFields: {
        allProductIds: {
          $reduce: {
            input: { $ifNull: ["$deals", []] },
            initialValue: [],
            in: {
              $concatArrays: [
                "$$value",
                {
                  $map: {
                    input: { $ifNull: ["$$this.products", []] },
                    as: "p",
                    in: "$$p.product",
                  },
                },
              ],
            },
          },
        },
      },
    });

    // ================= IDN =================
    pipeline.push({
      $lookup: {
        from: "idns",
        let: { idnId: "$idn" },
        pipeline: [
          {
            $match: {
              $expr: { $eq: ["$_id", "$$idnId"] },
            },
          },
          {
            $project: {
              _id: 0,
              name: 1,
            },
          },
        ],
        as: "idn",
      },
    });

    pipeline.push({
      $unwind: {
        path: "$idn",
        preserveNullAndEmptyArrays: true,
      },
    });

    // ================= GPO =================
    pipeline.push({
      $lookup: {
        from: "gpos",
        let: { gpoId: "$gpo" },
        pipeline: [
          {
            $match: {
              $expr: { $eq: ["$_id", "$$gpoId"] },
            },
          },
          {
            $project: {
              _id: 0,
              name: 1,
            },
          },
        ],
        as: "gpo",
      },
    });

    pipeline.push({
      $unwind: {
        path: "$gpo",
        preserveNullAndEmptyArrays: true,
      },
    });

    // ================= PRODUCTS =================
    pipeline.push({
      $lookup: {
        from: "products",
        localField: "allProductIds",
        foreignField: "_id",
        as: "productsData",
      },
    });

    // ================= MAP PRODUCTS =================
    pipeline.push({
      $addFields: {
        deals: {
          $map: {
            input: { $ifNull: ["$deals", []] },
            as: "deal",
            in: {
              $mergeObjects: [
                "$$deal",
                {
                  products: {
                    $map: {
                      input: { $ifNull: ["$$deal.products", []] },
                      as: "prod",
                      in: {
                        product: {
                          $arrayElemAt: [
                            {
                              $map: {
                                input: {
                                  $filter: {
                                    input: "$productsData",
                                    as: "p",
                                    cond: {
                                      $eq: ["$$p._id", "$$prod.product"],
                                    },
                                  },
                                },
                                as: "m",
                                in: "$$m.name",
                              },
                            },
                            0,
                          ],
                        },

                        dealAmount: "$$prod.dealAmount",
                        stage: "$$prod.stage",
                        expectedCloseDate: "$$prod.expectedCloseDate",
                        dealDate: "$$prod.dealDate",
                      },
                    },
                  },
                },
              ],
            },
          },
        },
      },
    });

    // ================= ADD LATEST DEAL DATE =================
    pipeline.push({
      $addFields: {
        deals: {
          $map: {
            input: { $ifNull: ["$deals", []] },
            as: "d",
            in: {
              $mergeObjects: [
                "$$d",
                {
                  dealMaxDate: {
                    $max: {
                      $map: {
                        input: { $ifNull: ["$$d.products", []] },
                        as: "p",
                        in: "$$p.dealDate",
                      },
                    },
                  },
                },
              ],
            },
          },
        },
      },
    });

    // ================= SORT + LIMIT 2 LATEST DEALS =================
    pipeline.push({
      $addFields: {
        deals: {
          $slice: [
            {
              $sortArray: {
                input: "$deals",
                sortBy: { dealMaxDate: -1 },
              },
            },
            2,
          ],
        },
      },
    });

    // ================= DATE CALC =================
    pipeline.push({
      $addFields: {
        allDates: {
          $reduce: {
            input: { $ifNull: ["$deals", []] },
            initialValue: [],
            in: {
              $concatArrays: [
                "$$value",
                {
                  $map: {
                    input: "$$this.products",
                    as: "p",
                    in: "$$p.expectedCloseDate",
                  },
                },
              ],
            },
          },
        },
      },
    });

    pipeline.push({
      $addFields: {
        minExpectedCloseDate: {
          $cond: [
            { $gt: [{ $size: "$allDates" }, 0] },
            { $min: "$allDates" },
            null,
          ],
        },
      },
    });

    // ================= SEARCH =================
    if (search.trim()) {
      const hospitalNameCond = buildFieldWordSearchCondition("hospitalName", search);
      const cityCond = buildFieldWordSearchCondition("city", search);
      const idnCond = buildFieldWordSearchCondition("idn.name", search);
      pipeline.push({
        $match: {
          $or: [hospitalNameCond, cityCond, idnCond].filter(Boolean),
        },
      });
    }

    // ================= SORT =================
    pipeline.push({
      $sort: { minExpectedCloseDate: 1 },
    });

    // ================= EXTRACT BEDS FROM LATEST DEAL =================
    pipeline.push({
      $addFields: {
        beds: {
          $ifNull: [
            {
              $arrayElemAt: [{ $arrayElemAt: ["$deals.products.beds", 0] }, 0],
            },
            0,
          ],
        },
      },
    });

    // ================= PROJECT =================
    pipeline.push({
      $project: {
        hospitalName: 1,
        city: 1,
        state: 1,
        zip: 1,
        beds: 1,
        idn: 1,
        gpo: 1,
        deals: 1,
        minExpectedCloseDate: 1,
      },
    });

    // ================= PAGINATION =================
    pipeline.push({
      $facet: {
        data: [{ $skip: skip }, { $limit: limit }],
        totalCount: [{ $count: "count" }],
      },
    });

    const result = await Hospital.aggregate(pipeline);

    const hospitals = result[0]?.data || [];
    const total = result[0]?.totalCount[0]?.count || 0;

    res.status(200).json({
      success: true,
      page,
      limit,
      totalHospitals: total,
      totalPages: Math.ceil(total / limit),
      data: hospitals,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};
