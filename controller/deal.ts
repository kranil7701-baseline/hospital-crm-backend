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
import Contact from "../model/Contact.ts";

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
    const limit = req.query.limit
      ? parseInt(req.query.limit as string)
      : page
        ? 15
        : null;
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
                  _id: "$hospital._id",
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
                // product: "$products.product",
                product: {
                  _id: "$products.product._id",
                  name: "$products.product.name",
                },
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
            { $sort: { dealAmount: -1 } },
            ...(page || limit
              ? [{ $skip: skip }, ...(limit ? [{ $limit: limit }] : [])]
              : []),
          ],

          totalDealsCount: [{ $count: "count" }],

          totalHospitals: [
            { $group: { _id: "$hospital._id" } },
            { $count: "count" },
          ],

          closedBusiness: [
            {
              $match: {
                "products.stage": { $in: ["Closed Won", "Implemented"] },
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
        },
      },
    ];

    const result = await Deal.aggregate(pipeline);

    const deals = result[0]?.deals || [];
    const totalDealsCount = result[0]?.totalDealsCount[0]?.count || 0;
    const totalHospitals = result[0]?.totalHospitals[0]?.count || 0;
    const closedBusiness = result[0]?.closedBusiness[0]?.amount || 0;

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
      page: page || 1,
      limit: limit || totalDealsCount,
      totalPages: limit ? Math.ceil(totalDealsCount / limit) : 1,
      totalHospitals,
      closedBusiness: closedBusiness,
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

    // ✅ Permission checks
    const isAdminOrCustomerSuccess =
      loggedInUser?.role === UserRole.ADMIN ||
      loggedInUser?.role === UserRole.CUSTOMER_SUCCESS;

    const isDealOwner = deal.user.toString() === loggedInUser?._id?.toString();

    // ✅ Only admin or deal owner can update
    if (!isAdminOrCustomerSuccess && !isDealOwner) {
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
        new: true,
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
    const {
      dealId,
      dealAmount,
      quantity,
      stage,
      expectedCloseDate,
      dealDate,
      userId,
      beds,
      notes,
    } = req.body;

    if (!dealId) {
      res.status(400).json({
        success: false,
        message: "dealId is required",
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

    // authorization check
    const isAdminOrCustomerSuccess =
      req.user?.role === UserRole.ADMIN ||
      req.user?.role === UserRole.CUSTOMER_SUCCESS;

    if (
      !isAdminOrCustomerSuccess &&
      deal.user.toString() !== req.user?._id.toString()
    ) {
      res.status(403).json({
        success: false,
        message: "You are not authorized to update this deal",
      });
      return;
    }

    const updateFields: any = {};

    // update product fields
    if (dealAmount !== undefined) {
      updateFields["products.0.dealAmount"] = Number(dealAmount);
    }

    if (quantity !== undefined) {
      updateFields["products.0.quantity"] = Number(quantity);
    }

    if (beds !== undefined) {
      updateFields["products.0.beds"] = Number(beds);
    }

    if (stage) {
      updateFields["products.0.stage"] = stage;
    }

    if (expectedCloseDate) {
      updateFields["products.0.expectedCloseDate"] = expectedCloseDate;
    }

    if (dealDate) {
      updateFields["products.0.dealDate"] = dealDate;
    }

    // notes
    if (notes !== undefined) {
      updateFields.notes = notes;
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
    }

    const updatedDeal = await Deal.findByIdAndUpdate(
      dealId,
      {
        $set: updateFields,
      },
      {
        new: true,
        runValidators: true,
      },
    )
      .populate("hospital", "hospitalName")
      .populate("user", "name email")
      .populate("products.product", "name");

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
          $or: [{ user: objectUserId }, { _id: { $in: matchedHospitalIds } }],
        };

    // =========================
    // 🔥 BASIC COUNTS
    // =========================
    const [totalHospitals, totalHospitalsInDB, totalProductsInDB] =
      await Promise.all([
        Hospital.countDocuments(hospitalFilter),

        Hospital.countDocuments({}),

        Product.countDocuments({}),
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
      "Ghosted",
      "Implemented",
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
                        $in: ["$products.stage", ["Closed Won", "Closed Lost"]],
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
    let productCount = 0;

    if (isAdminOrCustomerSuccessOrExecutive) {
      const totalHospitals = await Hospital.countDocuments();

      const totalDeals = await Deal.countDocuments();

      hospitalCount = totalHospitals;
      productCount = totalDeals;
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
        { user: objectUserId },
        "_id",
      ).lean();

      const assignedHospitalIds = assignedHospitals.map((h: any) =>
        h._id.toString(),
      );
      const uniqueHospitalIds = new Set([
        ...matchedHospitalIds,
        ...assignedHospitalIds,
      ]);

      hospitalCount = uniqueHospitalIds.size;
      productCount = userDeals.length;
    }

    res.status(200).json({
      success: true,
      hospitalCount,
      productCount,
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
