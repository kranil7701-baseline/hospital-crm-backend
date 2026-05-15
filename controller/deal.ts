import type { Request, Response } from "express";
import type { AuthRequest } from "../middleware/authMiddleware.ts";
import Deal from "../model/deal.ts";
import mongoose from "mongoose";
import Product from "../model/Product.ts";
import Hospital from "../model/Hospital.ts";
import Task from "../model/Task.ts";
import Notes from "../model/Notes.ts";
import CallLog from "../model/CallLogs.ts";
import { UserRole } from "../model/User.ts";

/*
export const getDeals = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const searchQuery = (req.query.search as string) || "";
    const userId = req.query.userId as string;

    const matchStage: any = {};

    // ✅ Filter by userId
    if (userId && mongoose.Types.ObjectId.isValid(userId)) {
      matchStage.user = new mongoose.Types.ObjectId(userId);
    }

    // =========================
    // ✅ 1. DEAL PIPELINE
    // =========================
    const pipeline: any[] = [
      { $match: matchStage },

      {
        $facet: {
          // =========================
          // DEALS DATA
          // =========================
          deals: [
            {
              $unwind: {
                path: "$products",
                preserveNullAndEmptyArrays: true
              }
            },

            ...(searchQuery
              ? [
                {
                  $match: {
                    "products.stage": {
                      $regex: searchQuery,
                      $options: "i"
                    }
                  }
                }
              ]
              : []),

            // Hospital
            {
              $lookup: {
                from: "hospitals",
                localField: "hospital",
                foreignField: "_id",
                as: "hospital"
              }
            },
            { $unwind: { path: "$hospital", preserveNullAndEmptyArrays: true } },

            // IDN
            {
              $lookup: {
                from: "idns",
                localField: "hospital.idn",
                foreignField: "_id",
                as: "idn"
              }
            },
            { $unwind: { path: "$idn", preserveNullAndEmptyArrays: true } },

            // GPO
            {
              $lookup: {
                from: "gpos",
                localField: "hospital.gpo",
                foreignField: "_id",
                as: "gpo"
              }
            },
            { $unwind: { path: "$gpo", preserveNullAndEmptyArrays: true } },

            // Product
            {
              $lookup: {
                from: "products",
                localField: "products.product",
                foreignField: "_id",
                as: "products.product"
              }
            },
            {
              $unwind: {
                path: "$products.product",
                preserveNullAndEmptyArrays: true
              }
            },

            // User
            {
              $lookup: {
                from: "users",
                localField: "user",
                foreignField: "_id",
                as: "user"
              }
            },
            { $unwind: { path: "$user", preserveNullAndEmptyArrays: true } },

            // Final shape
            {
              $project: {
                dealId: "$_id",

                hospital: {
                  hospitalName: "$hospital.hospitalName",
                  city: "$hospital.city",
                  state: "$hospital.state",
                  zip: "$hospital.zip",
                  idn: {
                    _id: "$idn._id",
                    name: "$idn.name"
                  },
                  gpo: {
                    _id: "$gpo._id",
                    name: "$gpo.name"
                  }
                },

                product: "$products.product",
                dealAmount: "$products.dealAmount",
                quantity: "$products.quantity",
                stage: "$products.stage",

                user: {
                  _id: "$user._id",
                  name: "$user.name"
                },

                createdAt: 1
              }
            },

            { $sort: { createdAt: -1 } }
          ],

          // =========================
          // TOTAL HOSPITALS
          // =========================
          totalHospitals: [
            {
              $group: {
                _id: "$hospital"
              }
            },
            { $count: "count" }
          ],

          // =========================
          // CLOSED BUSINESS
          // =========================
          closedBusiness: [
            { $unwind: "$products" },
            {
              $match: {
                "products.stage": "Closed Won"
              }
            },
            { $count: "count" }
          ]
        }
      }
    ];

    const result = await Deal.aggregate(pipeline);

    const deals = result[0]?.deals || [];
    const totalHospitals = result[0]?.totalHospitals[0]?.count || 0;
    const closedBusiness = result[0]?.closedBusiness[0]?.count || 0;

    // =========================
    // ✅ 2. PRODUCT REVENUE (SEPARATE FIX)
    // =========================
    const productRevenue = await Product.aggregate([
      {
        $lookup: {
          from: "deals",
          let: { productId: "$_id" },
          pipeline: [
            { $match: matchStage },
            { $unwind: "$products" },
            {
              $match: {
                $expr: {
                  $eq: ["$products.product", "$$productId"]
                }
              }
            }
          ],
          as: "dealData"
        }
      },
      {
        $addFields: {
          ARR: {
            $sum: {
              $map: {
                input: "$dealData",
                as: "d",
                in: {
                  $ifNull: ["$$d.products.dealAmount", 0]
                }
              }
            }
          }
        }
      },
      {
        $project: {
          _id: 0,
          productId: "$_id",
          productName: "$name",
          ARR: 1
        }
      },
      { $sort: { ARR: -1 } }
    ]);

    // =========================
    // ✅ FINAL RESPONSE
    // =========================
    res.status(200).json({
      success: true,
      totalDeals: deals.length,
      totalHospitals,
      closedBusiness,
      productRevenue, // ✅ always returns (even if 0)
      data: deals
    });

  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: "Failed to retrieve deals",
      error: error.message
    });
  }
};
*/

export const getDeals = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const searchQuery = (req.query.search as string) || "";
    const userId = req.query.userId as string;
    const productIdsRaw = req.query.productIds as string | string[];
    const gpoId = req.query.gpoId as string;
    const page = req.query.page ? parseInt(req.query.page as string) : null;
    const limit = req.query.limit ? parseInt(req.query.limit as string) : (page ? 15 : null);
    const skip = page ? (page - 1) * (limit || 15) : 0;

    let productIds: mongoose.Types.ObjectId[] = [];
    if (productIdsRaw) {
      const idsArray = Array.isArray(productIdsRaw)
        ? productIdsRaw
        : (productIdsRaw as string).split(",");
      productIds = idsArray
        .filter((id) => mongoose.Types.ObjectId.isValid(id.trim()))
        .map((id) => new mongoose.Types.ObjectId(id.trim()));
    }

    const matchStage: any = {};

    // =========================
    // 🔥 USER FILTER
    // =========================
    if (userId && mongoose.Types.ObjectId.isValid(userId)) {
      matchStage.user = new mongoose.Types.ObjectId(userId);
    }

    // =========================
    // 🔥 GPO FILTER
    // =========================
    if (gpoId && mongoose.Types.ObjectId.isValid(gpoId)) {
      matchStage.gpo = new mongoose.Types.ObjectId(gpoId);
    }

    // =========================
    // 🔥 MAIN PIPELINE
    // =========================
    const pipeline: any[] = [
      { $match: matchStage },

      {
        $unwind: {
          path: "$products",
          preserveNullAndEmptyArrays: true,
        },
      },

      // 🔥 PRODUCT FILTER
      ...(productIds.length > 0
        ? [
          {
            $match: {
              "products.product": { $in: productIds },
            },
          },
        ]
        : []),

      // 🔥 ENRICH WITH HOSPITAL (Needed for search)
      {
        $lookup: {
          from: "hospitals",
          localField: "hospital",
          foreignField: "_id",
          as: "hospital",
        },
      },
      { $unwind: { path: "$hospital", preserveNullAndEmptyArrays: true } },

      // 🔥 SEARCH FILTER
      ...(searchQuery
        ? [
          {
            $match: {
              $or: [
                { "products.stage": { $regex: searchQuery, $options: "i" } },
                {
                  "hospital.hospitalName": {
                    $regex: searchQuery,
                    $options: "i",
                  },
                },
              ],
            },
          },
        ]
        : []),

      {
        $facet: {
          // =========================
          // DEALS DATA
          // =========================
          deals: [
            {
              $lookup: {
                from: "idns",
                localField: "hospital.idn",
                foreignField: "_id",
                as: "idn",
              },
            },
            { $unwind: { path: "$idn", preserveNullAndEmptyArrays: true } },

            {
              $lookup: {
                from: "gpos",
                localField: "hospital.gpo",
                foreignField: "_id",
                as: "gpo",
              },
            },
            { $unwind: { path: "$gpo", preserveNullAndEmptyArrays: true } },

            {
              $lookup: {
                from: "products",
                localField: "products.product",
                foreignField: "_id",
                as: "products.product",
              },
            },
            {
              $unwind: {
                path: "$products.product",
                preserveNullAndEmptyArrays: true,
              },
            },

            {
              $lookup: {
                from: "users",
                localField: "user",
                foreignField: "_id",
                as: "user",
              },
            },
            { $unwind: { path: "$user", preserveNullAndEmptyArrays: true } },

            {
              $project: {
                dealId: "$_id",
                hospital: {
                  hospitalName: "$hospital.hospitalName",
                  city: "$hospital.city",
                  state: "$hospital.state",
                  zip: "$hospital.zip",
                  idn: {
                    _id: "$idn._id",
                    name: "$idn.name",
                  },
                  gpo: {
                    _id: "$gpo._id",
                    name: "$gpo.name",
                  },
                },
                product: "$products.product",
                dealAmount: "$products.dealAmount",
                quantity: "$products.quantity",
                beds: "$products.beds",
                stage: "$products.stage",
                user: {
                  _id: "$user._id",
                  name: "$user.name",
                },
                createdAt: 1,
                expectedCloseDate: "$products.expectedCloseDate",
              },
            },
            { $sort: { createdAt: -1 } },
            ...(page || limit ? [
              { $skip: skip },
              ...(limit ? [{ $limit: limit }] : [])
            ] : []),
          ],

          totalDealsCount: [{ $count: "count" }],

          totalHospitals: [
            { $group: { _id: "$hospital._id" } },
            { $count: "count" },
          ],

          closedBusiness: [
            { $match: { "products.stage": "Closed Won" } },
            { $count: "count" },
          ],
        },
      },
    ];

    const result = await Deal.aggregate(pipeline);

    const deals = result[0]?.deals || [];
    const totalDealsCount = result[0]?.totalDealsCount[0]?.count || 0;
    const totalHospitals = result[0]?.totalHospitals[0]?.count || 0;
    const closedBusiness = result[0]?.closedBusiness[0]?.count || 0;

    const productRevenue = await Product.aggregate([
      {
        $lookup: {
          from: "deals",
          let: { productId: "$_id" },
          pipeline: [
            // 🔥 USER FILTER (important)
            ...(userId && mongoose.Types.ObjectId.isValid(userId)
              ? [
                {
                  $match: {
                    user: new mongoose.Types.ObjectId(userId),
                  },
                },
              ]
              : []),

            // 🔥 GPO FILTER
            ...(gpoId && mongoose.Types.ObjectId.isValid(gpoId)
              ? [
                {
                  $match: {
                    gpo: new mongoose.Types.ObjectId(gpoId),
                  },
                },
              ]
              : []),

            { $unwind: "$products" },

            // 🔥 PRODUCT MATCH
            {
              $match: {
                $expr: {
                  $eq: ["$products.product", "$$productId"],
                },
              },
            },
          ],
          as: "dealData",
        },
      },

      // =========================
      // 🔥 ARR LOGIC (UPDATED)
      // =========================
      {
        $addFields: {
          ARR: {
            $cond: [
              // if productIds are passed → only those products get real revenue
              productIds.length > 0
                ? {
                  $in: ["$_id", productIds],
                }
                : true,

              // true case → sum revenue
              {
                $sum: "$dealData.products.dealAmount",
              },

              // false case → force 0
              0,
            ],
          },
        },
      },

      {
        $project: {
          _id: 0,
          productId: "$_id",
          productName: "$name",
          ARR: 1,
        },
      },

      { $sort: { ARR: -1 } },
    ]);

    res.status(200).json({
      success: true,
      totalDeals: totalDealsCount,
      page: page || 1,
      limit: limit || totalDealsCount,
      totalPages: limit ? Math.ceil(totalDealsCount / limit) : 1,
      totalHospitals,
      closedBusiness,
      productRevenue,
      data: deals,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: "Failed to retrieve deals",
      error: error.message,
    });
  }
};

export const createDeal = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const { products, beds, ...rest } = req.body;

    if (!products || !products.length) {
      res.status(400).json({
        success: false,
        message: "At least one product is required",
      });
      return;
    }

    const hospitalId = rest.hospital;
    const productIds = products.map((p: any) => p.product);

    // Check if any of these product deals already exist for this hospital
    const existingDeals = await Deal.find({
      hospital: hospitalId,
      "products.product": { $in: productIds },
    });

    if (existingDeals.length > 0) {
      res.status(400).json({
        success: false,
        message: "One or more of these products already have a deal for this hospital",
      });
      return;
    }

    const dealsToInsert = products.map((product: any) => ({
      ...rest,
      user: req.user?._id,
      products: [{ ...product, beds: beds ? Number(beds) : 0 }], // only ONE product per document
    }));

    const createdDeals = await Deal.insertMany(dealsToInsert);

    res.status(201).json({
      success: true,
      count: createdDeals.length,
      data: createdDeals,
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: "Failed to create deals",
      error: error.message,
    });
  }
};

export const updateDealProductStage = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { dealId, productId, stage } = req.body;

    // ✅ Validation
    if (!dealId || !productId || !stage) {
      res.status(400).json({
        success: false,
        message: "dealId, productId and stage are required",
      });
      return;
    }

    // ✅ Validate ObjectIds
    if (
      !mongoose.Types.ObjectId.isValid(dealId) ||
      !mongoose.Types.ObjectId.isValid(productId)
    ) {
      res.status(400).json({
        success: false,
        message: "Invalid ObjectId(s)",
      });
      return;
    }

    // ✅ Update stage (no hospital filter)
    const updatedDeal = await Deal.findOneAndUpdate(
      {
        _id: new mongoose.Types.ObjectId(dealId),
        "products.product": new mongoose.Types.ObjectId(productId),
      },
      {
        $set: {
          "products.$.stage": stage,
        },
      },
      {
        new: true,
        runValidators: true,
      },
    );

    if (!updatedDeal) {
      res.status(404).json({
        success: false,
        message: "Deal or product not found",
      });
      return;
    }

    res.status(200).json({
      success: true,
      message: "Stage updated successfully",
      data: updatedDeal,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: "Failed to update stage",
      error: error.message,
    });
  }
};

export const removeDeal = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const dealId = req.params.dealId || (req.query.dealId as string);

    if (!dealId) {
      res.status(400).json({
        success: false,
        message: "dealId is required",
      });
      return;
    }

    const deletedDeal = await Deal.findByIdAndDelete(dealId);

    if (!deletedDeal) {
      res.status(404).json({
        success: false,
        message: "Deal not found",
      });
      return;
    }

    res.status(200).json({
      success: true,
      message: "Deal deleted successfully",
      //  data: deletedDeal
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: "Failed to delete deal",
      error: error.message,
    });
  }
};

export const addProductToDeal = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const hospitalId = req.query.hospitalId as string;

    const {
      product,
      dealAmount,
      quantity,
      stage,
      expectedCloseDate,
      dealDate,
      idn,
      gpo,
    } = req.body;

    if (!hospitalId || !product || !idn || !gpo) {
      res.status(400).json({
        success: false,
        message: "hospitalId, product, idn and gpo are required",
      });
      return;
    }

    // Check if a deal with the same product already exists for this hospital
    const existingDeal = await Deal.findOne({
      hospital: hospitalId,
      "products.product": product,
    });

    if (existingDeal) {
      res.status(400).json({
        success: false,
        message: "A deal for this product already exists for this hospital",
      });
      return;
    }

    const newDeal = new Deal({
      hospital: hospitalId,
      idn,
      gpo,
      user: (req as any).user?._id, // if using auth
      products: [
        {
          product,
          dealAmount,
          quantity,
          stage,
          expectedCloseDate,
          dealDate,
        },
      ],
    });

    await newDeal.save();

    res.status(201).json({
      success: true,
      message: "Deal created successfully",
      data: newDeal,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: "Failed to create deal",
      error: error.message,
    });
  }
};

export const updateDeal = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const { dealId, dealAmount, quantity, stage, expectedCloseDate, dealDate, product, userId, beds } =
      req.body;

    if (!dealId) {
      res.status(400).json({
        success: false,
        message: "dealId is required",
      });
      return;
    }

    // 🔥 Find deal first as per instruction
    const deal = await Deal.findById(dealId);
    if (!deal) {
      res.status(404).json({
        success: false,
        message: "Deal not found",
      });
      return;
    }

    const updateFields: any = {};

    if (product) {
      // 🔥 Validation: Check if another deal for the same hospital already has this product
      const existingDeal = await Deal.findOne({
        _id: { $ne: dealId },
        hospital: deal.hospital,
        "products.product": product,
      });

      if (existingDeal) {
        res.status(400).json({
          success: false,
          message: "A deal for this product already exists for this hospital",
        });
        return;
      }
      updateFields["products.0.product"] = product;
    }
    if (dealAmount !== undefined)
      updateFields["products.0.dealAmount"] = dealAmount;
    if (quantity !== undefined)
      updateFields["products.0.quantity"] = quantity;
    if (stage) updateFields["products.0.stage"] = stage;
    if (expectedCloseDate)
      updateFields["products.0.expectedCloseDate"] = expectedCloseDate;
    if (dealDate) updateFields["products.0.dealDate"] = dealDate;

    // Handle beds: update current deal's fields
    if (beds !== undefined) {
      updateFields["products.0.beds"] = Number(beds);
    }

    // Handle User assignment
    if (userId) {
      const isAdmin = req.user?.role === UserRole.ADMIN;

      if (isAdmin) {
        updateFields.user = userId;
      } else {
        if (deal.user.toString() !== userId) {
          res.status(403).json({
            success: false,
            message: "Only admin can change assigned user",
          });
          return;
        }
        updateFields.user = userId;
      }
    }

    const updatedDeal = await Deal.findByIdAndUpdate(
      dealId,
      { $set: updateFields },
      { new: true, runValidators: true },
    );

    res.status(200).json({
      success: true,
      message: "Deal updated successfully",
      data: updatedDeal,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: "Failed to update deal",
      error: error.message,
    });
  }
};




export const getDashboardStats = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const userId = req.user?._id;

    if (!userId) {
      res.status(401).json({ success: false, message: "Unauthorized" });
      return;
    }

    const objectUserId = new mongoose.Types.ObjectId(userId);

    // =========================
    // 🔥 BASIC COUNTS
    // =========================
    const [totalHospitals, totalHospitalsInDB, totalProductsInDB] =
      await Promise.all([
        Hospital.countDocuments({ user: objectUserId }),
        Hospital.countDocuments({}),
        Product.countDocuments({}),
      ]);

    // =========================
    // 🔥 TASKS + ACTIVITY
    // =========================
    const [tasks, notes, callLogs] = await Promise.all([
      Task.find({ user: objectUserId }).sort({ createdAt: -1 }).limit(5),
      Notes.find({ user: objectUserId }).sort({ createdAt: -1 }).limit(5),
      CallLog.find({ user: objectUserId })
        .populate("contact", "firstName lastName") // 🔥 POPULATED CONTACT
        .sort({ createdAt: -1 })
        .limit(5),
    ]);

    // =========================
    // 🔥 STAGES MASTER
    // =========================
    const stages = [
      "Demo",
      "CPA",
      "Committee",
      "Trial",
      "Pending Decision",
      "Closed Won",
      "Implemented",
    ];

    // =========================
    // 🔥 AGGREGATION
    // =========================
    const result = await Deal.aggregate([
      { $match: { user: objectUserId } },
      { $unwind: "$products" },

      {
        $facet: {
          // ================= TOTALS =================
          totals: [
            {
              $group: {
                _id: null,

                totalPipelineAmount: {
                  $sum: "$products.dealAmount",
                },

                // ================= ACTIVE DEALS =================
                activeDealsCount: {
                  $sum: {
                    $cond: [
                      {
                        $and: [
                          { $ne: ["$products.stage", "Closed Won"] },
                          { $ne: ["$products.stage", "Implemented"] },
                        ],
                      },
                      1,
                      0,
                    ],
                  },
                },
              },
            },
          ],

          // ================= PIPELINE =================
          pipelineRaw: [
            {
              $group: {
                _id: "$products.stage",
                amount: { $sum: "$products.dealAmount" },
                hospitals: { $addToSet: "$hospital" },
              },
            },
            {
              $project: {
                _id: 0,
                stage: "$_id",
                amount: 1,
                hospitalCount: { $size: "$hospitals" },
              },
            },
          ],

          // ================= CLOSED BUSINESS =================
          closedBusinessRaw: [
            {
              $match: {
                "products.stage": { $in: ["Closed Won", "Implemented"] },
              },
            },
            {
              $group: {
                _id: null,
                totalAmount: { $sum: "$products.dealAmount" },
                hospitals: { $addToSet: "$hospital" },
              },
            },
            {
              $project: {
                _id: 0,
                totalAmount: 1,
                hospitalCount: { $size: "$hospitals" },
              },
            },
          ],
        },
      },
    ]);

    const data = result[0];

    // =========================
    // 🔥 PIPELINE MAP
    // =========================
    const pipelineMap = new Map<string, any>(
      (data?.pipelineRaw || []).map((p: any) => [p.stage, p]),
    );

    const pipeline = stages.map((stage) => ({
      stage,
      amount: pipelineMap.get(stage)?.amount || 0,
      hospitalCount: pipelineMap.get(stage)?.hospitalCount || 0,
    }));

    // =========================
    // 🔥 FINAL RESPONSE
    // =========================
    res.status(200).json({
      success: true,
      data: {
        totalHospitals,
        totalHospitalsInDB,
        totalProductsInDB,

        // 🔥 NEW
        activeDeals: data?.totals?.[0]?.activeDealsCount || 0,

        totalPipelineAmount: data?.totals?.[0]?.totalPipelineAmount || 0,

        closedBusiness: {
          totalAmount: data?.closedBusinessRaw?.[0]?.totalAmount || 0,
          hospitalCount: data?.closedBusinessRaw?.[0]?.hospitalCount || 0,
        },

        pipeline,

        tasks: tasks || [],

        // =========================
        // 🔥 RECENT ACTIVITY (MERGED)
        // =========================
        recentActivity: [
          ...(notes || []).map((n) => ({
            type: "note",
            data: n,
            createdAt: n.createdAt,
          })),

          ...(callLogs || []).map((c) => ({
            type: "callLog",
            data: c,
            createdAt: c.createdAt,
          })),
        ]
          .sort(
            (a, b) =>
              new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
          )
          .slice(0, 5),
      },
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch dashboard stats",
      error: error.message,
    });
  }
};

export const getClosedWonDeals = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const userId = req.user?._id;
    if (!userId) {
      res.status(401).json({ success: false, message: "Unauthorized" });
      return;
    }

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const search = (req.query.search as string) || "";
    const skip = (page - 1) * limit;

    const objectUserId = new mongoose.Types.ObjectId(userId);

    const pipeline: any[] = [
      { $match: { user: objectUserId } },
      { $unwind: "$products" },
      { $match: { "products.stage": "Closed Won" } },

      // lookup product details
      {
        $lookup: {
          from: "products",
          localField: "products.product",
          foreignField: "_id",
          pipeline: [{ $project: { _id: 1, name: 1 } }],
          as: "products.productDetail",
        },
      },
      { $unwind: "$products.productDetail" },

      // Group by hospital
      {
        $group: {
          _id: "$hospital",
          products: {
            $push: {
              _id: "$products._id",
              product: "$products.productDetail",
              dealAmount: "$products.dealAmount",
              quantity: "$products.quantity",
              stage: "$products.stage",
              expectedCloseDate: "$products.expectedCloseDate",
              dealDate: "$products.dealDate",
            },
          },
          totalAmount: { $sum: "$products.dealAmount" },
          productsCount: { $sum: 1 },
        },
      },

      // Lookup hospital details
      {
        $lookup: {
          from: "hospitals",
          localField: "_id",
          foreignField: "_id",
          as: "hospital",
        },
      },
      { $unwind: "$hospital" },

      // Search by hospital name
      ...(search
        ? [
          {
            $match: {
              "hospital.hospitalName": { $regex: search, $options: "i" },
            },
          },
        ]
        : []),

      {
        $project: {
          _id: "$hospital._id",
          hospitalName: "$hospital.hospitalName",
          products: 1,
          totalAmount: 1,
          productsCount: 1,
        },
      },

      { $sort: { hospitalName: 1 } },

      {
        $facet: {
          data: [{ $skip: skip }, { $limit: limit }],
          totalCount: [{ $count: "count" }],
          overallStats: [
            {
              $group: {
                _id: null,
                totalAmount: { $sum: "$totalAmount" },
                totalProducts: { $sum: "$productsCount" },
              },
            },
          ],
        },
      },
    ];

    const result = await Deal.aggregate(pipeline);
    const data = result[0]?.data || [];
    const total = result[0]?.totalCount[0]?.count || 0;
    const overall = result[0]?.overallStats[0] || {
      totalAmount: 0,
      totalProducts: 0,
    };

    res.status(200).json({
      success: true,
      page,
      limit,
      totalHospitals: total,
      totalPages: Math.ceil(total / limit),
      hasMore: total > skip + data.length,
      amount: overall.totalAmount,
      productsCount: overall.totalProducts,
      data: data,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch closed won deals",
      error: error.message,
    });
  }
};

export const getImplementedDeals = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const userId = req.user?._id;
    if (!userId) {
      res.status(401).json({ success: false, message: "Unauthorized" });
      return;
    }

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const search = (req.query.search as string) || "";
    const skip = (page - 1) * limit;

    const objectUserId = new mongoose.Types.ObjectId(userId);

    const pipeline: any[] = [
      { $match: { user: objectUserId } },
      { $unwind: "$products" },
      { $match: { "products.stage": "Implemented" } },

      // lookup product details
      {
        $lookup: {
          from: "products",
          localField: "products.product",
          foreignField: "_id",
          pipeline: [{ $project: { _id: 1, name: 1 } }],
          as: "products.productDetail",
        },
      },
      { $unwind: "$products.productDetail" },

      // Group by hospital
      {
        $group: {
          _id: "$hospital",
          products: {
            $push: {
              _id: "$products._id",
              product: "$products.productDetail",
              dealAmount: "$products.dealAmount",
              quantity: "$products.quantity",
              stage: "$products.stage",
              expectedCloseDate: "$products.expectedCloseDate",
              dealDate: "$products.dealDate",
            },
          },
          totalAmount: { $sum: "$products.dealAmount" },
          productsCount: { $sum: 1 },
        },
      },

      // Lookup hospital details
      {
        $lookup: {
          from: "hospitals",
          localField: "_id",
          foreignField: "_id",
          as: "hospital",
        },
      },
      { $unwind: "$hospital" },

      // Search by hospital name
      ...(search
        ? [
          {
            $match: {
              "hospital.hospitalName": { $regex: search, $options: "i" },
            },
          },
        ]
        : []),

      {
        $project: {
          _id: "$hospital._id",
          hospitalName: "$hospital.hospitalName",
          products: 1,
          totalAmount: 1,
          productsCount: 1,
        },
      },

      { $sort: { hospitalName: 1 } },

      {
        $facet: {
          data: [{ $skip: skip }, { $limit: limit }],
          totalCount: [{ $count: "count" }],
          overallStats: [
            {
              $group: {
                _id: null,
                totalAmount: { $sum: "$totalAmount" },
                totalProducts: { $sum: "$productsCount" },
              },
            },
          ],
        },
      },
    ];

    const result = await Deal.aggregate(pipeline);
    const data = result[0]?.data || [];
    const total = result[0]?.totalCount[0]?.count || 0;
    const overall = result[0]?.overallStats[0] || {
      totalAmount: 0,
      totalProducts: 0,
    };

    res.status(200).json({
      success: true,
      page,
      limit,
      totalHospitals: total,
      totalPages: Math.ceil(total / limit),
      hasMore: total > skip + data.length,
      amount: overall.totalAmount,
      productsCount: overall.totalProducts,
      data: data,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch implemented deals",
      error: error.message,
    });
  }
};
