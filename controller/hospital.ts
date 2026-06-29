import type { Request, Response } from "express";
import type { AuthRequest } from "../middleware/authMiddleware.ts";
import Hospital from "../model/Hospital.ts";
import GPO from "../model/Gpo.ts";
import IDN from "../model/Idn.ts";
import mongoose from "mongoose";
import Deal from "../model/deal.ts";
import Contact from "../model/Contact.ts";
import { UserRole } from "../model/User.ts";

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

    if (search) {
      matchStage.$or = [
        { hospitalName: { $regex: search, $options: "i" } },
        { city: { $regex: search, $options: "i" } },
      ];
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
      .populate("idn", "name")
      .populate("gpo", "name");

    if (!hospital) {
      res.status(404).json({
        success: false,
        message: "Hospital not found",
      });
      return;
    }

    // 2. Get contacts linked to hospital ✅
    const contacts = await Contact.find({ hospital: id }).select(
      "firstName lastName phoneNumber designation email isPrimary",
    );

    // 3. Get deals
    const rawDeals = await Deal.find({ hospital: id })
      .select("products leadSource leadSourceDetails")
      .populate({
        path: "products.product",
        select: "name",
      });

    const deals = rawDeals.map((deal: any) => {
      const dealObj = deal.toObject();
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

    // 4. Final response
    const responseData = {
      ...hospital.toObject(),
      beds: totalBeds, // ICU beds plus all deal product beds
      productInfo,
      contacts, // Manually attached contacts
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

export const createHospital = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const hospitalData = {
      ...req.body,
      user: req.body.userId || req.body.user || req.user?._id,
    };

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

    await Hospital.findByIdAndDelete(id);

    res.status(200).json({
      success: true,
      message: "Hospital deleted successfully",
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

    const updateData = { ...req.body };

    // Restrict Sales role from editing certain fields
    if (req.user?.role === UserRole.SALES) {
      // Remove restricted fields if present
      delete updateData.hospitalName;
      delete updateData.idn;
      delete updateData.address;
    }

    // Check if the 'user' field is being changed
    if (
      updateData.user &&
      updateData.user.toString() !== hospital.user.toString()
    ) {
      // if (req.user?.role !== UserRole.ADMIN) {
      //   res.status(403).json({
      //     success: false,
      //     message: "Only Admin can change the assigned user of a hospital",
      //   });
      //   return;
      // }
      if (
        req.user?.role !== UserRole.ADMIN &&
        req.user?.role !== UserRole.CUSTOMER_SUCCESS
      ) {
        res.status(403).json({
          success: false,
          message:
            "Only Admin or Customer Success can change the assigned user of a hospital",
        });
        return;
      }
    }

    // 🔥 1. Update hospital
    const updatedHospital = await Hospital.findByIdAndUpdate(id, updateData, {
      new: true,
      runValidators: true,
    })
      .populate("idn", "name")
      .populate("gpo", "name")
      .populate("contacts", "firstName lastName designation phoneNumber email");

    if (!updatedHospital) {
      res.status(404).json({ success: false, message: "Hospital not found" });
      return;
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

    if (isAdminOrExecutiveOrCustomerSuccess) {
      if (reqUserId && mongoose.Types.ObjectId.isValid(reqUserId)) {
        filterUserId = new mongoose.Types.ObjectId(reqUserId);
      }
    } else {
      if (req.user?._id) {
        filterUserId = new mongoose.Types.ObjectId(
          req.user._id as unknown as string,
        );
      }
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
          $or: [{ user: filterUserId }, { _id: { $in: matchedHospitalIds } }],
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
    if (search) {
      pipeline.push({
        $match: {
          $or: [
            { hospitalName: { $regex: search, $options: "i" } },
            { city: { $regex: search, $options: "i" } },
            { "idn.name": { $regex: search, $options: "i" } },
          ],
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
