import type { Request, Response } from "express";
import type { AuthRequest } from "../middleware/authMiddleware.ts";
import Deal from "../model/deal.ts";
import mongoose from "mongoose";
import Product from "../model/Product.ts";
import Hospital from "../model/Hospital.ts";
import { UserRole } from "../model/User.ts";
import { buildFieldWordSearchCondition } from "../helper/searchHelper.ts";

export const getDeals = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const rawSearch =
      (req.query.search as string) ||
      (req.query.searchQuery as string) ||
      (req.query.query as string) ||
      (req.query.q as string) ||
      "";
    const searchQuery =
      rawSearch === "undefined" || rawSearch === "null"
        ? ""
        : rawSearch.trim();
    const userId = req.query.userId as string;
    const productIdsRaw = req.query.productIds as string | string[];
    const gpoId = req.query.gpoId as string;
    const leadSourceRaw = req.query.leadSource as string;
    const leadSource = leadSourceRaw
      ? decodeURIComponent(leadSourceRaw.replace(/\+/g, " ")).trim()
      : "";

    const page = req.query.page ? parseInt(req.query.page as string) : null;
    const limit = req.query.limit
      ? parseInt(req.query.limit as string)
      : page
        ? 15
        : null;
    const skip = page ? (page - 1) * (limit || 15) : 0;
    const dealStageRaw = req.query.dealStage;
    const dealStages = (
      Array.isArray(dealStageRaw) ? dealStageRaw : [dealStageRaw]
    )
      .map((stage) => (typeof stage === "string" ? stage : ""))
      .flatMap((stage) => stage.split(","))
      .map((stage) => stage.trim())
      .filter(Boolean);

    const usePaginationFilter =
      page !== null && limit !== null && dealStages.length === 0;
    const sortBy = (req.query.sortBy as string) || "dealAmount";
    const sortOrder = (req.query.sortOrder as string) === "asc" ? 1 : -1;
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

    if (userId && mongoose.Types.ObjectId.isValid(userId)) {
      matchStage.user = new mongoose.Types.ObjectId(userId);
    }

    const pipeline: any[] = [
      { $match: matchStage },

      {
        $unwind: {
          path: "$products",
          preserveNullAndEmptyArrays: true,
        },
      },

      ...(productIds.length > 0
        ? [
          {
            $match: {
              "products.product": { $in: productIds },
            },
          },
        ]
        : []),

      ...(dealStages.length > 0
        ? [
          {
            $match: {
              "products.stage": { $in: dealStages },
            },
          },
        ]
        : []),

      {
        $lookup: {
          from: "hospitals",
          localField: "hospital",
          foreignField: "_id",
          as: "hospital",
        },
      },
      { $unwind: { path: "$hospital", preserveNullAndEmptyArrays: true } },

      ...(gpoId && mongoose.Types.ObjectId.isValid(gpoId)
        ? [
          {
            $match: {
              "hospital.gpo": new mongoose.Types.ObjectId(gpoId),
            },
          },
        ]
        : []),

      ...(leadSource && leadSource !== "all"
        ? [
          {
            $match: {
              ...(leadSource === "none"
                ? {
                  $or: [
                    { "products.leadSource": { $exists: false } },
                    { "products.leadSource": null },
                    { "products.leadSource": "" },
                    { "products.leadSource": "none" },
                  ],
                }
                : {
                  "products.leadSource": {
                    $regex: new RegExp(`^${leadSource.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&")}$`, "i"),
                  },
                }),
            },
          },
        ]
        : []),

      ...(searchQuery.trim()
        ? [
          {
            $match: {
              $or: [
                buildFieldWordSearchCondition("products.stage", searchQuery),
                buildFieldWordSearchCondition("hospital.hospitalName", searchQuery),
              ].filter(Boolean),
            },
          },
        ]
        : []),

      {
        $facet: {
          deals: [
            ...(usePaginationFilter
              ? [
                {
                  $match: {
                    "products.stage": {
                      $nin: [
                        "Closed Won",
                        "Closed Lost",
                        "Implemented",
                        "No Longer Buying",
                        // "Ghosted",
                      ],
                    },
                  },
                },
              ]
              : []),
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

            // Lookup notes for this hospital and product
            {
              $lookup: {
                from: "notes",
                let: { hospitalId: "$hospital._id", productId: "$products.product._id" },
                pipeline: [
                  {
                    $match: {
                      $expr: {
                        $and: [
                          { $eq: ["$hospital", "$$hospitalId"] },
                          {
                            $or: [
                              { $in: ["$$productId", { $ifNull: ["$products", []] }] },
                              { $eq: [{ $size: { $ifNull: ["$products", []] } }, 0] }
                            ]
                          }
                        ]
                      }
                    }
                  },
                  { $project: { createdAt: 1, updatedAt: 1 } }
                ],
                as: "notes"
              }
            },

            // Lookup call logs for this hospital and product
            {
              $lookup: {
                from: "calllogs",
                let: { hospitalId: "$hospital._id", productId: "$products.product._id" },
                pipeline: [
                  {
                    $match: {
                      $expr: {
                        $and: [
                          { $eq: ["$hospital", "$$hospitalId"] },
                          {
                            $or: [
                              { $in: ["$$productId", { $ifNull: ["$products", []] }] },
                              { $eq: [{ $size: { $ifNull: ["$products", []] } }, 0] }
                            ]
                          }
                        ]
                      }
                    }
                  },
                  { $project: { Date: 1, createdAt: 1, updatedAt: 1 } }
                ],
                as: "calllogs"
              }
            },

            // Lookup tasks for this hospital and product
            {
              $lookup: {
                from: "tasks",
                let: { hospitalId: "$hospital._id", productId: "$products.product._id" },
                pipeline: [
                  {
                    $match: {
                      $expr: {
                        $and: [
                          { $eq: ["$hospital", "$$hospitalId"] },
                          {
                            $or: [
                              { $in: ["$$productId", { $ifNull: ["$products", []] }] },
                              { $eq: [{ $size: { $ifNull: ["$products", []] } }, 0] }
                            ]
                          }
                        ]
                      }
                    }
                  },
                  { $project: { dueDate: 1, completed: 1, createdAt: 1, updatedAt: 1 } }
                ],
                as: "tasks"
              }
            },

            // Compute lastActivityDate and nextActivityDate
            {
              $addFields: {
                noteDates: {
                  $reduce: {
                    input: "$notes",
                    initialValue: [],
                    in: {
                      $concatArrays: ["$$value", ["$$this.createdAt", "$$this.updatedAt"]]
                    }
                  }
                },
                callDates: {
                  $reduce: {
                    input: "$calllogs",
                    initialValue: [],
                    in: {
                      $concatArrays: ["$$value", ["$$this.Date", "$$this.createdAt", "$$this.updatedAt"]]
                    }
                  }
                },
                taskDates: {
                  $reduce: {
                    input: "$tasks",
                    initialValue: [],
                    in: {
                      $concatArrays: ["$$value", ["$$this.createdAt", "$$this.updatedAt"]]
                    }
                  }
                },
                futureTaskDates: {
                  $map: {
                    input: {
                      $filter: {
                        input: "$tasks",
                        as: "t",
                        cond: {
                          $ne: ["$$t.completed", true]
                        }
                      }
                    },
                    as: "t",
                    in: "$$t.dueDate"
                  }
                }
              }
            },
            {
              $addFields: {
                allPastDates: {
                  $concatArrays: ["$noteDates", "$callDates", "$taskDates"]
                }
              }
            },
            {
              $addFields: {
                lastActivityDate: {
                  $reduce: {
                    input: "$allPastDates",
                    initialValue: null,
                    in: {
                      $cond: [
                        {
                          $or: [
                            { $eq: ["$$value", null] },
                            { $gt: ["$$this", "$$value"] }
                          ]
                        },
                        "$$this",
                        "$$value"
                      ]
                    }
                  }
                },
                nextActivityDate: {
                  $reduce: {
                    input: "$futureTaskDates",
                    initialValue: null,
                    in: {
                      $cond: [
                        {
                          $or: [
                            { $eq: ["$$value", null] },
                            { $lt: ["$$this", "$$value"] }
                          ]
                        },
                        "$$this",
                        "$$value"
                      ]
                    }
                  }
                }
              }
            },

            {
              $project: {
                dealId: "$_id",
                hospital: {
                  _id: "$hospital._id",
                  hospitalName: "$hospital.hospitalName",
                  city: "$hospital.city",
                  state: "$hospital.state",
                  zip: "$hospital.zip",
                  totalBeds: "$hospital.totalBeds",
                  idn: {
                    _id: "$idn._id",
                    name: "$idn.name",
                  },
                  gpo: {
                    _id: "$gpo._id",
                    name: "$gpo.name",
                  },
                },
                product: {
                  _id: "$products.product._id",
                  name: "$products.product.name",
                },
                dealAmount: "$products.dealAmount",
                quantity: "$hospital.totalBeds",
                beds: "$products.beds",
                stage: "$products.stage",
                user: {
                  _id: "$user._id",
                  name: "$user.name",
                },
                createdAt: 1,
                updatedAt: 1,
                leadSource: "$products.leadSource",
                leadSourceDetails: "$products.leadSourceDetails",
                expectedCloseDate: "$products.expectedCloseDate",
                lastActivityDate: 1,
                nextActivityDate: 1,
              },
            },
            { $sort: { [sortBy]: sortOrder } },
            ...(page || limit
              ? [{ $skip: skip }, ...(limit ? [{ $limit: limit }] : [])]
              : []),
          ],

          totalDealsCount: [
            ...(usePaginationFilter
              ? [
                {
                  $match: {
                    "products.stage": {
                      $nin: [
                        "Closed Won",
                        "Closed Lost",
                        "Implemented",
                        "No Longer Buying",
                      ],
                    },
                  },
                },
              ]
              : []),
            { $count: "count" },
          ],

          totalHospitals: [
            ...(usePaginationFilter
              ? [
                {
                  $match: {
                    "products.stage": {
                      $nin: [
                        "Closed Won",
                        "Closed Lost",
                        "Implemented",
                        "No Longer Buying",
                      ],
                    },
                  },
                },
              ]
              : []),
            { $group: { _id: "$hospital._id" } },
            { $count: "count" },
          ],

          closedBusiness: [
            {
              $match: {
                "products.stage": "Closed Won",
              },
            },
            {
              $group: {
                _id: null,
                amount: { $sum: "$products.dealAmount" },
              },
            },
            {
              $project: {
                _id: 0,
                amount: 1,
              },
            },
          ],

          implementedBusiness: [
            {
              $match: {
                "products.stage": "Implemented",
              },
            },
            {
              $group: {
                _id: null,
                count: { $sum: 1 },
                amount: { $sum: "$products.dealAmount" },
              },
            },
            {
              $project: {
                _id: 0,
                count: 1,
                amount: 1,
              },
            },
          ],

          activeDealsCount: [
            {
              $match: {
                "products.stage": {
                  $in: [
                    "Demo",
                    "CPA",
                    "Committee",
                    "Trial",
                    "Pending Decision",
                  ],
                },
              },
            },
            { $count: "count" },
          ],
        },
      },
    ];

    const result = await Deal.aggregate(pipeline);

    console.log("[Aggregate Debug] leadSource:", leadSource);
    console.log("[Aggregate Debug] Result deals count:", result[0]?.deals?.length);
    if (result[0]?.deals?.length > 0) {
      console.log("[Aggregate Debug] Sample leadSources:", result[0].deals.slice(0, 5).map((d: any) => d.leadSource));
    }

    const deals = result[0]?.deals || [];
    const totalDealsCount = result[0]?.totalDealsCount[0]?.count || 0;
    const totalHospitals = result[0]?.totalHospitals[0]?.count || 0;
    const closedBusiness = result[0]?.closedBusiness[0]?.amount || 0;
    const implementedARR = result[0]?.implementedBusiness[0]?.amount || 0;
    const activeDeals = result[0]?.activeDealsCount[0]?.count || 0;

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
            {
              $lookup: {
                from: "hospitals",
                localField: "hospital",
                foreignField: "_id",
                as: "hospitalDoc",
              },
            },
            { $unwind: "$hospitalDoc" },

            ...(gpoId && mongoose.Types.ObjectId.isValid(gpoId)
              ? [
                {
                  $match: {
                    "hospitalDoc.gpo": new mongoose.Types.ObjectId(gpoId),
                  },
                },
              ]
              : []),

            { $unwind: "$products" },
            {
              $match: {
                "products.stage": {
                  $nin: ["Closed Won", "Closed Lost", "Implemented", "No Longer Buying"],
                },
              },
            },
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
      {
        $addFields: {
          ARR: {
            $cond: [
              productIds.length > 0
                ? {
                  $in: ["$_id", productIds],
                }
                : true,
              {
                $sum: "$dealData.products.dealAmount",
              },
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
      activeDeals,
      page: page || 1,
      limit: limit || totalDealsCount,
      totalPages: limit ? Math.ceil(totalDealsCount / limit) : 1,
      totalHospitals,
      closedBusiness: closedBusiness,
      implementedARR,
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
        message:
          "One or more of these products already have a deal for this hospital",
      });
      return;
    }

    const dealsToInsert = products.map((product: any) => ({
      ...rest,
      user: rest.userId || req.body.userId || req.body.user || req.user?._id,
      products: [
        {
          ...product,
          leadSource: product.leadSource || rest.leadSource,
          leadSourceDetails: product.leadSourceDetails || rest.leadSourceDetails,
          beds: product.beds !== undefined ? Number(product.beds) : (beds ? Number(beds) : 0),
        },
      ],
    }));
    // Remove leadSource from deal root since it's now per-product
    dealsToInsert.forEach((d: any) => {
      delete d.leadSource;
      delete d.leadSourceDetails;
    });

    const createdDeals = await Deal.insertMany(dealsToInsert);

    const dealUser = rest.userId || req.body.userId || req.body.user || req.user?._id;
    if (dealUser) {
      const hospital = await Hospital.findById(hospitalId);
      if (hospital) {
        if (!hospital.primaryRep && !hospital.secondaryRep) {
          hospital.primaryRep = dealUser;
        } else if (hospital.primaryRep && !hospital.secondaryRep && hospital.primaryRep.toString() !== dealUser.toString()) {
          hospital.secondaryRep = dealUser;
        }
        await hospital.save();
      }
    }

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
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const { dealId, productId, stage } = req.body;

    // ✅ Logged in user
    const loggedInUser = req.user;

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

    // ✅ Find deal first
    const deal = await Deal.findById(dealId);

    if (!deal) {
      res.status(404).json({
        success: false,
        message: "Deal not found",
      });
      return;
    }

    // ✅ Find hospital to check its assigned user
    const hospital = await Hospital.findById(deal.hospital);

    // ✅ Permission checks
    const isAdminOrCustomerSuccess =
      loggedInUser?.role === UserRole.ADMIN ||
      loggedInUser?.role === UserRole.CUSTOMER_SUCCESS;

    const isDealOwner = deal.user.toString() === loggedInUser?._id?.toString();

    const isPrimaryRep = hospital?.primaryRep?.toString() === loggedInUser?._id?.toString();
    const isSecondaryRep = hospital?.secondaryRep?.toString() === loggedInUser?._id?.toString();

    if (!isAdminOrCustomerSuccess && !isDealOwner && !isPrimaryRep && !isSecondaryRep) {
      res.status(403).json({
        success: false,
        message: "You are not authorized to update this deal stage",
      });
      return;
    }

    // ✅ Update product stage
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
        returnDocument: "after",
        runValidators: true,
      },
    );

    if (!updatedDeal) {
      res.status(404).json({
        success: false,
        message: "Product not found in this deal",
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
  req: AuthRequest,
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

    const deal = await Deal.findById(dealId);

    if (!deal) {
      res.status(404).json({
        success: false,
        message: "Deal not found",
      });
      return;
    }

    const hospital = await Hospital.findById(deal.hospital);

    const isAdminOrCustomerSuccess =
      req.user?.role === UserRole.ADMIN ||
      req.user?.role === UserRole.CUSTOMER_SUCCESS;

    const isDealOwner = deal.user.toString() === req.user?._id.toString();

    const isPrimaryRep = hospital?.primaryRep?.toString() === req.user?._id.toString();
    const isSecondaryRep = hospital?.secondaryRep?.toString() === req.user?._id.toString();

    if (
      !isAdminOrCustomerSuccess &&
      !isDealOwner &&
      !isPrimaryRep &&
      !isSecondaryRep
    ) {
      res.status(403).json({
        success: false,
        message: "You are not authorized to delete this deal",
      });
      return;
    }

    await Deal.findByIdAndDelete(dealId);

    res.status(200).json({
      success: true,
      message: "Deal deleted successfully",
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
      leadSource,
      leadSourceDetails,
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
      user: (req as any).user?._id,
      products: [
        {
          product,
          dealAmount,
          quantity,
          stage,
          expectedCloseDate,
          dealDate,
          leadSource,
          leadSourceDetails,
        },
      ],
    });

    await newDeal.save();

    // Self-assignment: set primaryRep or secondaryRep based on availability
    const dealUser = (req as any).user?._id;
    if (dealUser) {
      const hospital = await Hospital.findById(hospitalId);
      if (hospital) {
        if (!hospital.primaryRep && !hospital.secondaryRep) {
          hospital.primaryRep = dealUser;
        } else if (hospital.primaryRep && !hospital.secondaryRep && hospital.primaryRep.toString() !== dealUser.toString()) {
          hospital.secondaryRep = dealUser;
        }
        await hospital.save();
      }
    }

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
    const {
      dealId,
      product: productId,
      dealAmount,
      quantity,
      stage,
      expectedCloseDate,
      dealDate,
      userId,
      beds,
      notes,
      leadSource,
      leadSourceDetails,
    } = req.body;

    if (!dealId) {
      res.status(400).json({
        success: false,
        message: "dealId is required",
      });
      return;
    }

    if (!productId) {
      res.status(400).json({
        success: false,
        message: "product is required to identify which product in the deal to update",
      });
      return;
    }

    // find deal
    const deal = await Deal.findById(dealId);

    if (!deal) {
      res.status(404).json({
        success: false,
        message: "Deal not found",
      });
      return;
    }

    // find hospital to check its assigned user
    const hospital = await Hospital.findById(deal.hospital);

    // authorization check
    const isAdminOrCustomerSuccess =
      req.user?.role === UserRole.ADMIN ||
      req.user?.role === UserRole.CUSTOMER_SUCCESS;

    const isDealOwner = deal.user.toString() === req.user?._id.toString();

    const isPrimaryRep = hospital?.primaryRep?.toString() === req.user?._id.toString();
    const isSecondaryRep = hospital?.secondaryRep?.toString() === req.user?._id.toString();

    if (
      !isAdminOrCustomerSuccess &&
      !isDealOwner &&
      !isPrimaryRep &&
      !isSecondaryRep
    ) {
      res.status(403).json({
        success: false,
        message: "You are not authorized to update this deal",
      });
      return;
    }

    const updateFields: any = {};

    // update product fields using positional operator $
    if (dealAmount !== undefined) {
      updateFields["products.$.dealAmount"] = Number(dealAmount);
    }

    if (quantity !== undefined) {
      updateFields["products.$.quantity"] = Number(quantity);
    }

    if (beds !== undefined) {
      updateFields["products.$.beds"] = Number(beds);
    }

    if (stage) {
      updateFields["products.$.stage"] = stage;
    }

    if (expectedCloseDate) {
      updateFields["products.$.expectedCloseDate"] = expectedCloseDate;
    }

    if (dealDate) {
      updateFields["products.$.dealDate"] = dealDate;
    }

    // notes
    if (notes !== undefined) {
      updateFields.notes = notes;
    }

    if (leadSource !== undefined) {
      updateFields["products.$.leadSource"] = leadSource;
    }

    if (leadSourceDetails !== undefined) {
      updateFields["products.$.leadSourceDetails"] = leadSourceDetails;
    }

    // only admin can change assigned user
    if (userId) {
      if (!isAdminOrCustomerSuccess) {
        res.status(403).json({
          success: false,
          message: "Only admin can change assigned user",
        });
        return;
      }

      updateFields.user = userId;

      // 🔥 Update the hospital's primary rep
      if (deal.hospital) {
        await Hospital.findByIdAndUpdate(deal.hospital, {
          primaryRep: userId === "" || userId === null ? null : userId,
        });
      }
    }

    const updatedDeal = await Deal.findOneAndUpdate(
      {
        _id: new mongoose.Types.ObjectId(dealId),
        "products.product": new mongoose.Types.ObjectId(productId),
      },
      {
        $set: updateFields,
      },
      {
        returnDocument: "after",
        runValidators: true,
      },
    )
      .populate("hospital", "hospitalName")
      .populate("user", "name email")
      .populate("products.product", "name");

    if (!updatedDeal) {
      res.status(404).json({
        success: false,
        message: "Product not found in this deal",
      });
      return;
    }

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
    const userRole = req.user?.role;

    if (!userId) {
      res.status(401).json({ success: false, message: "Unauthorized" });
      return;
    }

    const objectUserId = new mongoose.Types.ObjectId(userId);

    // 🔥 Check if Admin, Executive or Customer Success
    const isAdminOrCustomerSuccessOrExecutive =
      userRole === UserRole.ADMIN ||
      userRole === UserRole.EXECUTIVE ||
      userRole === UserRole.CUSTOMER_SUCCESS;

    // =========================
    // 🔥 DEAL FILTER
    // =========================
    const dealMatchFilter = isAdminOrCustomerSuccessOrExecutive
      ? {}
      : { user: objectUserId };

    // =========================
    // 🔥 GET HOSPITAL IDS
    // =========================
    const userDeals = await Deal.find(dealMatchFilter, "hospital").lean();

    const matchedHospitalIds = userDeals
      .map((d: any) => d.hospital)
      .filter((id: any) => id != null);

    // =========================
    // 🔥 HOSPITAL FILTER
    // =========================
    const hospitalFilter = isAdminOrCustomerSuccessOrExecutive
      ? {}
      : {
        $or: [{ primaryRep: objectUserId }, { secondaryRep: objectUserId }, { _id: { $in: matchedHospitalIds } }],
      };

    // =========================
    // 🔥 BASIC COUNTS
    // =========================
    const [totalHospitals, totalHospitalsInDB, totalProductsInDB, totalDeals] =
      await Promise.all([
        Hospital.countDocuments(hospitalFilter),

        Hospital.countDocuments({}),

        Product.countDocuments({}),

        Deal.countDocuments(dealMatchFilter),
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
      "Closed Lost",
      // "Ghosted",
      "Implemented",
      "No Longer Buying",
    ];

    // =========================
    // 🔥 AGGREGATION
    // =========================
    const result = await Deal.aggregate([
      { $match: dealMatchFilter },

      { $unwind: "$products" },

      {
        $facet: {
          // ================= TOTALS =================
          totals: [
            {
              $group: {
                _id: null,

                totalPipelineAmount: {
                  $sum: {
                    $cond: [
                      {
                        $in: [
                          "$products.stage",
                          [
                            "Closed Won",
                            "Closed Lost",
                            // "Ghosted",
                            "Implemented",
                            "No Longer Buying",
                          ],
                        ],
                      },
                      0,
                      "$products.dealAmount",
                    ],
                  },
                },

                activeDealsCount: {
                  $sum: {
                    $cond: [
                      {
                        $and: [
                          { $ne: ["$products.stage", "Closed Won"] },
                          { $ne: ["$products.stage", "Implemented"] },
                          { $ne: ["$products.stage", "Closed Lost"] },
                          // { $ne: ["$products.stage", "Ghosted"] },
                          { $ne: ["$products.stage", "No Longer Buying"] },
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
                "products.stage": "Closed Won",
              },
            },
            {
              $group: {
                _id: null,
                totalAmount: {
                  $sum: "$products.dealAmount",
                },
                hospitals: {
                  $addToSet: "$hospital",
                },
              },
            },
            {
              $project: {
                _id: 0,
                totalAmount: 1,
                hospitalCount: {
                  $size: "$hospitals",
                },
              },
            },
          ],

          implementedRaw: [
            {
              $match: {
                "products.stage": "Implemented",
              },
            },
            {
              $group: {
                _id: null,
                totalAmount: {
                  $sum: "$products.dealAmount",
                },
                hospitals: {
                  $addToSet: "$hospital",
                },
              },
            },
            {
              $project: {
                _id: 0,
                totalAmount: 1,
                hospitalCount: {
                  $size: "$hospitals",
                },
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
        totalDeals,

        activeDeals: data?.totals?.[0]?.activeDealsCount || 0,

        totalPipelineAmount: data?.totals?.[0]?.totalPipelineAmount || 0,

        closedBusiness: {
          totalAmount: data?.closedBusinessRaw?.[0]?.totalAmount || 0,
          hospitalCount: data?.closedBusinessRaw?.[0]?.hospitalCount || 0,
        },

        implemented: {
          totalAmount: data?.implementedRaw?.[0]?.totalAmount || 0,
          hospitalCount: data?.implementedRaw?.[0]?.hospitalCount || 0,
        },

        pipeline,
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
    const rawSearch =
      (req.query.search as string) ||
      (req.query.searchQuery as string) ||
      (req.query.query as string) ||
      (req.query.q as string) ||
      "";
    const search =
      rawSearch === "undefined" || rawSearch === "null"
        ? ""
        : rawSearch.trim();
    const skip = (page - 1) * limit;

    const objectUserId = new mongoose.Types.ObjectId(userId);

    const isAdminOrCustomerSuccessOrExecutive =
      req.user?.role === UserRole.ADMIN ||
      req.user?.role === UserRole.EXECUTIVE ||
      req.user?.role === UserRole.CUSTOMER_SUCCESS;

    const dealMatchFilter = isAdminOrCustomerSuccessOrExecutive
      ? {}
      : { user: objectUserId };

    const pipeline: any[] = [
      { $match: dealMatchFilter },
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

      // Lookup hospital details
      {
        $lookup: {
          from: "hospitals",
          localField: "hospital",
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

      // Sort by nearest close date first
      {
        $addFields: {
          sortDate: {
            $ifNull: ["$products.expectedCloseDate", "$products.dealDate"],
          },
        },
      },

      // Group by hospital
      {
        $group: {
          _id: "$hospital._id",
          hospital: { $first: "$hospital" },
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
          nearestCloseDate: { $min: "$sortDate" },
        },
      },

      {
        $project: {
          _id: "$hospital._id",
          hospitalName: "$hospital.hospitalName",
          totalBeds: "$hospital.totalBeds",
          products: 1,
          totalAmount: 1,
          productsCount: 1,
          nearestCloseDate: 1,
        },
      },

      { $sort: { nearestCloseDate: 1, hospitalName: 1 } },

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
    const facetResult = result[0] || {};

    let data = facetResult.data || [];
    data = data.map((h: any) => {
      if (h.products) {
        h.products = h.products.map((p: any) => ({
          ...p,
          quantity: h.totalBeds || 0,
        }));
      }
      return h;
    });

    const totalCount = facetResult.totalCount?.[0]?.count || 0;
    const overallStats = facetResult.overallStats?.[0] || {
      totalAmount: 0,
      totalProducts: 0,
    };

    res.status(200).json({
      success: true,
      page,
      limit,
      totalDeals: totalCount,
      totalPages: Math.ceil(totalCount / limit),
      hasMore: totalCount > skip + data.length,
      amount: overallStats.totalAmount,
      productsCount: overallStats.totalProducts,
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
      res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
      return;
    }

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const rawSearch =
      (req.query.search as string) ||
      (req.query.searchQuery as string) ||
      (req.query.query as string) ||
      (req.query.q as string) ||
      "";
    const search =
      rawSearch === "undefined" || rawSearch === "null"
        ? ""
        : rawSearch.trim();
    const skip = (page - 1) * limit;

    const objectUserId = new mongoose.Types.ObjectId(userId);

    const isAdminOrCustomerSuccessOrExecutive =
      req.user?.role === UserRole.ADMIN ||
      req.user?.role === UserRole.EXECUTIVE ||
      req.user?.role === UserRole.CUSTOMER_SUCCESS;

    const dealMatchFilter = isAdminOrCustomerSuccessOrExecutive
      ? {}
      : { user: objectUserId };


    //  const pipeline = [
    //   { $match: { "products.stage": "Closed Won" } },
    //   { $sort: { sortDate: 1 } },

    //   
    //   { $skip: skip },
    //   { $limit: limit }, 

    //   
    //   { $group: { _id: "$hospital", ... } },
    //   { $lookup: { from: "hospitals", ... } },
    //   { $unwind: "$hospital" },

    //   
    //   ...(search ? [
    //     { $match: { "hospital.hospitalName": { $regex: search, $options: "i" } } }
    //   ] : []),
    // ];


    const pipeline: any[] = [
      { $match: dealMatchFilter },

      { $unwind: "$products" },

      {
        $match: {
          "products.stage": "Implemented",
        },
      },

      {
        $lookup: {
          from: "products",
          localField: "products.product",
          foreignField: "_id",
          pipeline: [
            {
              $project: {
                _id: 1,
                name: 1,
              },
            },
          ],
          as: "products.productDetail",
        },
      },

      {
        $unwind: {
          path: "$products.productDetail",
          preserveNullAndEmptyArrays: true,
        },
      },

      // GROUP BY DEAL ID (NOT HOSPITAL)
      {
        $group: {
          _id: "$_id",
          hospital: { $first: "$hospital" },
          user: { $first: "$user" },
          gpo: { $first: "$gpo" },
          idn: { $first: "$idn" },
          createdAt: { $first: "$createdAt" },

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

          totalAmount: {
            $sum: {
              $ifNull: ["$products.dealAmount", 0],
            },
          },

          productsCount: {
            $sum: 1,
          },

          minExpectedCloseDate: {
            $min: "$products.expectedCloseDate",
          },
          minDealDate: {
            $min: "$products.dealDate",
          },
        },
      },

      {
        $addFields: {
          sortDate: {
            $ifNull: ["$minExpectedCloseDate", "$minDealDate"],
          },
        },
      },

      {
        $lookup: {
          from: "hospitals",
          localField: "hospital",
          foreignField: "_id",
          as: "hospital",
        },
      },

      {
        $unwind: {
          path: "$hospital",
          preserveNullAndEmptyArrays: true,
        },
      },

      ...(search
        ? [
          {
            $match: {
              "hospital.hospitalName": {
                $regex: search,
                $options: "i",
              },
            },
          },
        ]
        : []),

      {
        $project: {
          _id: 1,
          hospitalId: "$hospital._id",
          hospitalName: "$hospital.hospitalName",
          totalBeds: "$hospital.totalBeds",
          products: 1,
          totalAmount: 1,
          productsCount: 1,
          createdAt: 1,
          sortDate: 1,
        },
      },

      {
        $sort: {
          sortDate: 1,
          createdAt: -1,
        },
      },

      {
        $facet: {
          data: [{ $skip: skip }, { $limit: limit }],

          totalCount: [
            {
              $count: "count",
            },
          ],

          overallStats: [
            {
              $group: {
                _id: null,
                totalAmount: {
                  $sum: "$totalAmount",
                },
                totalProducts: {
                  $sum: "$productsCount",
                },
              },
            },
          ],
        },
      },
    ];

    const result = await Deal.aggregate(pipeline);

    const facetResult = result[0] || {};

    let data = facetResult.data || [];
    data = data.map((d: any) => {
      if (d.products) {
        d.products = d.products.map((p: any) => ({
          ...p,
          quantity: d.totalBeds || 0,
        }));
      }
      return d;
    });

    const totalCount = facetResult.totalCount?.[0]?.count || 0;

    const overallStats = facetResult.overallStats?.[0] || {
      totalAmount: 0,
      totalProducts: 0,
    };

    res.status(200).json({
      success: true,
      page,
      limit,
      totalDeals: totalCount,
      totalPages: Math.ceil(totalCount / limit),
      hasMore: totalCount > skip + data.length,
      amount: overallStats.totalAmount,
      productsCount: overallStats.totalProducts,
      data,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch implemented deals",
      error: error.message,
    });
  }
};

export const HospitalProductCount = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const userId = req.user?._id;
    const role = req.user?.role;

    if (!userId) {
      res.status(401).json({ success: false, message: "Unauthorized" });
      return;
    }

    const isAdminOrCustomerSuccessOrExecutive =
      role === UserRole.ADMIN ||
      role === UserRole.EXECUTIVE ||
      role === UserRole.CUSTOMER_SUCCESS;

    let hospitalCount = 0;
    let dealsCount = 0;
    let activeDealsCount = 0;

    const productCount = await Product.countDocuments();

    if (isAdminOrCustomerSuccessOrExecutive) {
      const totalHospitals = await Hospital.countDocuments();

      const totalDealsRes = await Deal.aggregate([
        { $unwind: "$products" },
        { $count: "count" },
      ]);

      // Count active product deals
      const activeDealsRes = await Deal.aggregate([
        { $unwind: "$products" },
        {
          $match: {
            "products.stage": {
              $in: ["Demo", "CPA", "Committee", "Trial", "Pending Decision"],
            },
          },
        },
        { $count: "count" },
      ]);

      hospitalCount = totalHospitals;
      dealsCount = totalDealsRes[0]?.count || 0;
      activeDealsCount = activeDealsRes[0]?.count || 0;
    } else {
      const objectUserId = new mongoose.Types.ObjectId(userId);

      const userDeals = await Deal.find(
        { user: objectUserId },
        "hospital",
      ).lean();

      const matchedHospitalIds = userDeals
        .map((d: any) => d.hospital?.toString())
        .filter((id: any) => id != null);
      const assignedHospitals = await Hospital.find(
        { $or: [{ primaryRep: objectUserId }, { secondaryRep: objectUserId }] },
        "_id",
      ).lean();

      const assignedHospitalIds = assignedHospitals.map((h: any) =>
        h._id.toString(),
      );
      const uniqueHospitalIds = new Set([
        ...matchedHospitalIds,
        ...assignedHospitalIds,
      ]);

      const totalDealsRes = await Deal.aggregate([
        { $match: { user: objectUserId } },
        { $unwind: "$products" },
        { $count: "count" },
      ]);

      // Count active product deals for specific user
      const activeDealsRes = await Deal.aggregate([
        { $match: { user: objectUserId } },
        { $unwind: "$products" },
        {
          $match: {
            "products.stage": {
              $in: ["Demo", "CPA", "Committee", "Trial", "Pending Decision"],
            },
          },
        },
        { $count: "count" },
      ]);

      hospitalCount = uniqueHospitalIds.size;
      dealsCount = totalDealsRes[0]?.count || 0;
      activeDealsCount = activeDealsRes[0]?.count || 0;
    }

    res.status(200).json({
      success: true,
      hospitalCount,
      dealsCount,
      productCount,
      activeDealsCount,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch hospital and product count",
      error: error.message,
    });
  }
};

export const DealsTesting = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const deals = await Deal.aggregate([
      {
        $unwind: "$products",
      },

      {
        $project: {
          _id: 0,
          dealid: "$_id",
          hospitalid: "$hospital",
          productid: "$products.product",
        },
      },
    ]);

    res.status(200).json({
      success: true,
      count: deals.length,
      data: deals,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const DealStageCounts = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    // No user-based filtering here — return counts across all deals
    const dealMatchFilter: any = {};

    const stages = [
      "Demo",
      "CPA",
      "Committee",
      "Trial",
      "Pending Decision",
      // "Ghosted",
      "Closed Lost",
      "Closed Won",
      "Implemented",
      "No Longer Buying",
    ];

    const stageCountsResult = await Deal.aggregate([
      { $match: dealMatchFilter },
      { $unwind: "$products" },
      {
        $group: {
          _id: "$products.stage",
          count: { $sum: 1 },
        },
      },
      {
        $project: {
          _id: 0,
          stage: "$_id",
          count: 1,
        },
      },
    ]);

    const stageCountsMap = new Map<string, number>(
      stageCountsResult.map((item: any) => [item.stage, item.count]),
    );

    const missingEntry = stageCountsResult.find(
      (i: any) =>
        i.stage === null ||
        (typeof i.stage === "string" && i.stage.trim() === ""),
    );
    const missingCount = missingEntry?.count || 0;

    // Count deals that have no products array or empty products
    const noProductsResult = await Deal.aggregate([
      { $match: dealMatchFilter },
      { $project: { products: { $ifNull: ["$products", []] } } },
      { $addFields: { productsSize: { $size: "$products" } } },
      { $match: { productsSize: 0 } },
      { $count: "count" },
    ]);
    const noProductsCount = noProductsResult[0]?.count || 0;

    // Count product entries where the `product` field is missing or null
    const productFieldMissingResult = await Deal.aggregate([
      { $match: dealMatchFilter },
      { $unwind: "$products" },
      {
        $match: {
          $or: [
            { "products.product": { $exists: false } },
            { "products.product": null },
          ],
        },
      },
      { $count: "count" },
    ]);
    const productFieldMissingCount = productFieldMissingResult[0]?.count || 0;

    const productMissingCount = noProductsCount + productFieldMissingCount;

    const stageCounts = stages.map((stage) => ({
      stage,
      count: stageCountsMap.get(stage) || 0,
    }));

    if (missingCount > 0) {
      stageCounts.push({ stage: "Missing", count: missingCount });
    }

    res.status(200).json({
      success: true,
      data: stageCounts,
      missingCount,
      productMissingCount,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch deal stage counts",
      error: error.message,
    });
  }
};
