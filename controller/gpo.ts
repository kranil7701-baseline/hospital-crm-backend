import type { Request, Response } from "express";
import type { AuthRequest } from "../middleware/authMiddleware.ts";
import GPOModel from "../model/Gpo.ts";
import Deal from "../model/deal.ts";
import Hospital from "../model/Hospital.ts";
import Product from "../model/Product.ts";
import mongoose from "mongoose";
import { UserRole } from "../model/User.ts";

export const GetGPONameIDS = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const gpos = await GPOModel.find({}, "_id name");

    const formattedGPOs = gpos.reduce(
      (acc: Record<string, string>, idn: any) => {
        acc[idn.name] = idn._id.toString();
        return acc;
      },
      {},
    );

    res.status(200).json(formattedGPOs);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch IDNs",
      error,
    });
  }
};

export const getGPOHospitalDealsbyID = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const gpoId = req.query.gpoId as string;
    if (!gpoId || !mongoose.Types.ObjectId.isValid(gpoId)) {
      res
        .status(400)
        .json({ success: false, message: "Invalid or missing gpoId" });
      return;
    }

    const page = parseInt((req.query.page as string) || "1", 10) || 1;
    const limit = parseInt((req.query.limit as string) || "10", 10) || 10;
    const skip = (page - 1) * limit;

    const isPrivileged =
      req.user?.role === UserRole.ADMIN ||
      req.user?.role === UserRole.EXECUTIVE ||
      req.user?.role === UserRole.CUSTOMER_SUCCESS;

    // Optional filters
    const hospitalId = req.query.hospitalId as string | undefined;
    const productId = req.query.productId as string | undefined;

    const hospitalMatch: any = { gpo: new mongoose.Types.ObjectId(gpoId) };
    if (!isPrivileged) {
      if (req.user?._id) {
        hospitalMatch.user = new mongoose.Types.ObjectId(
          req.user._id as unknown as string,
        );
      }
    }
    if (hospitalId && mongoose.Types.ObjectId.isValid(hospitalId)) {
      hospitalMatch._id = new mongoose.Types.ObjectId(hospitalId);
    }

    const hospitalPipeline: any[] = [
      { $match: hospitalMatch },
      {
        $lookup: {
          from: "deals",
          let: { hospitalId: "$_id", totalBeds: "$totalBeds" },
          pipeline: [
            {
              $match: {
                $expr: { $eq: ["$hospital", "$$hospitalId"] },
              },
            },
            {
              $unwind: { path: "$products", preserveNullAndEmptyArrays: true },
            },
            ...(productId && mongoose.Types.ObjectId.isValid(productId)
              ? [
                  {
                    $match: {
                      "products.product": new mongoose.Types.ObjectId(
                        productId,
                      ),
                    },
                  },
                ]
              : []),
            {
              $lookup: {
                from: "products",
                localField: "products.product",
                foreignField: "_id",
                as: "product",
              },
            },
            { $unwind: { path: "$product", preserveNullAndEmptyArrays: true } },
            {
              $project: {
                dealId: "$_id",
                productId: "$product._id",
                productName: "$product.name",
                dealAmount: "$products.dealAmount",
                beds: "$products.beds",
                stage: "$products.stage",
                expectedCloseDate: "$products.expectedCloseDate",
                dealDate: "$products.dealDate",
                createdAt: 1,
              },
            },
          ],
          as: "deals",
        },
      },
      {
        $addFields: {
          totalHospitalARR: {
            $sum: {
              $map: {
                input: { $ifNull: ["$deals", []] },
                as: "d",
                in: { $ifNull: ["$$d.dealAmount", 0] },
              },
            },
          },
        },
      },
      {
        $project: {
          _id: 1,
          hospitalName: "$hospitalName",
          city: "$city",
          state: "$state",
          zip: "$zip",
          deals: 1,
          totalHospitalARR: 1,
        },
      },
      { $sort: { totalHospitalARR: -1, hospitalName: 1 } },
      { $skip: skip },
      { $limit: limit },
    ];

    const results = await Hospital.aggregate(hospitalPipeline);

    const totalHospitals = await Hospital.countDocuments(hospitalMatch);

    const hospitalIdsForDeals = await Hospital.find(hospitalMatch)
      .select("_id")
      .lean();
    const hospitalIds = hospitalIdsForDeals.map((h: any) => h._id);

    let totalDeals = 0;
    if (hospitalIds.length > 0) {
      const dealsCountPipeline: any[] = [
        { $match: { hospital: { $in: hospitalIds } } },
        { $unwind: { path: "$products", preserveNullAndEmptyArrays: true } },
        ...(productId && mongoose.Types.ObjectId.isValid(productId)
          ? [
              {
                $match: {
                  "products.product": new mongoose.Types.ObjectId(productId),
                },
              },
            ]
          : []),
        {
          $group: { _id: "$_id" },
        },
        { $count: "totalDeals" },
      ];

      const dealsCountResult = await Deal.aggregate(dealsCountPipeline);
      totalDeals = dealsCountResult[0]?.totalDeals || 0;
    }

    res.status(200).json({
      success: true,
      data: results,
      pagination: {
        totalHospitals,
        totalDeals,
        page,
        limit,
        totalPages: Math.ceil(totalHospitals / limit),
      },
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: "Failed to get GPO hospital deals",
      error: error.message,
    });
  }
};

export const getGPOs = async (req: Request, res: Response): Promise<void> => {
  try {
    // Query params
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const search = (req.query.search as string) || "";

    const skip = (page - 1) * limit;

    // Search query (adjust fields as per your schema)
    const searchQuery = search
      ? {
          $or: [{ name: { $regex: search, $options: "i" } }],
        }
      : {};

    // Fetch GPOs
    const gpos = await GPOModel.find(searchQuery)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .select("name");

    const total = await GPOModel.countDocuments(searchQuery);

    res.status(200).json({
      success: true,
      page,
      limit,
      totalGPOs: total,
      totalPages: Math.ceil(total / limit),
      data: gpos,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: "Failed to retrieve GPOs",
      error: error.message,
    });
  }
};

export const getGPOById = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { id } = req.params;
    if (typeof id !== "string") {
      res.status(400).json({ success: false, message: "Invalid ID" });
      return;
    }

    const gpo = await GPOModel.findById(id).select("name");

    if (!gpo) {
      res.status(404).json({
        success: false,
        message: "GPO not found",
      });
      return;
    }

    res.status(200).json({
      success: true,
      data: gpo,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: "Error fetching GPO",
      error: error.message,
    });
  }
};

export const createGPO = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const gpoData = {
      ...req.body,
      user: req.user?._id,
    };

    const gpo = new GPOModel(gpoData);
    await gpo.save();

    res.status(201).json({
      success: true,
      data: gpo,
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: "Failed to create GPO",
      error: error.message,
    });
  }
};

export const deleteGPO = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    if (typeof id !== "string") {
      res.status(400).json({ success: false, message: "Invalid ID" });
      return;
    }

    const gpo = await GPOModel.findByIdAndDelete(id);

    if (!gpo) {
      res.status(404).json({ success: false, message: "GPO not found" });
      return;
    }

    res
      .status(200)
      .json({ success: true, message: "GPO deleted successfully" });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: "Error deleting GPO",
      error: error.message,
    });
  }
};

export const updateGPO = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    if (typeof id !== "string") {
      res.status(400).json({ success: false, message: "Invalid ID" });
      return;
    }

    const updatedGPO = await GPOModel.findByIdAndUpdate(id, req.body, {
      new: true,
      runValidators: true,
    });

    if (!updatedGPO) {
      res.status(404).json({ success: false, message: "GPO not found" });
      return;
    }

    res.status(200).json({
      success: true,
      data: updatedGPO,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: "Failed to update GPO",
      error: error.message,
    });
  }
};

export const getAllGPODeals = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const search = (req.query.search as string) || "";
    const reqUserId = req.query.userId as string;

    const skip = (page - 1) * limit;

    let userObjectId: mongoose.Types.ObjectId | null = null;
    const isAdminOrExecutiveOrCustomerSuccess =
      req.user?.role === UserRole.ADMIN ||
      req.user?.role === UserRole.EXECUTIVE ||
      req.user?.role === UserRole.CUSTOMER_SUCCESS;

    if (isAdminOrExecutiveOrCustomerSuccess) {
      if (reqUserId && mongoose.Types.ObjectId.isValid(reqUserId)) {
        userObjectId = new mongoose.Types.ObjectId(reqUserId);
      }
    } else {
      if (req.user?._id) {
        userObjectId = new mongoose.Types.ObjectId(
          req.user._id as unknown as string,
        );
      }
    }

    const matchStage: any = {};
    if (search) {
      matchStage.name = { $regex: search, $options: "i" };
    }

    const pipeline: any[] = [
      { $match: matchStage },

      // 🔥 STEP 1: Hospitals lookup for count only
      {
        $lookup: {
          from: "hospitals",
          let: { gpoId: "$_id" },
          pipeline: [
            {
              $match: {
                $expr: userObjectId
                  ? {
                      $and: [
                        { $eq: ["$gpo", "$$gpoId"] },
                        { $eq: ["$user", userObjectId] },
                      ],
                    }
                  : {
                      $eq: ["$gpo", "$$gpoId"],
                    },
              },
            },
            {
              $project: { _id: 1 },
            },
          ],
          as: "hospitals",
        },
      },

      // 🔥 STEP 2: Remove empty GPOs ONLY if userId exists
      ...(userObjectId
        ? [
            {
              $match: {
                "hospitals.0": { $exists: true },
              },
            },
          ]
        : []),

      // 🔥 STEP 3: Extract hospitalIds
      {
        $addFields: {
          hospitalIds: "$hospitals._id",
        },
      },

      // 🔥 STEP 4: Deals lookup (ONLY from those hospitals)
      {
        $lookup: {
          from: "deals",
          let: { hospitalIds: "$hospitalIds" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $in: ["$hospital", "$$hospitalIds"],
                },
              },
            },
            { $unwind: "$products" },
          ],
          as: "deals",
        },
      },

      // 🔥 STEP 5: GPO totals
      {
        $addFields: {
          gpoTotalExpectedARR: {
            $sum: "$deals.products.dealAmount",
          },
          totalHospitals: { $size: "$hospitals" },
        },
      },

      { $sort: { createdAt: -1 } },

      {
        $project: {
          _id: 1,
          name: 1,
          gpoTotalExpectedARR: 1,
          totalHospitals: 1,
        },
      },

      { $skip: skip },
      { $limit: limit },
    ];

    const gpos = await GPOModel.aggregate(pipeline);

    // ✅ Pagination count
    const totalPipeline: any[] = [
      { $match: matchStage },
      {
        $lookup: {
          from: "hospitals",
          let: { gpoId: "$_id" },
          pipeline: [
            {
              $match: {
                $expr: userObjectId
                  ? {
                      $and: [
                        { $eq: ["$gpo", "$$gpoId"] },
                        { $eq: ["$user", userObjectId] },
                      ],
                    }
                  : {
                      $eq: ["$gpo", "$$gpoId"],
                    },
              },
            },
          ],
          as: "hospitals",
        },
      },
      ...(userObjectId
        ? [{ $match: { "hospitals.0": { $exists: true } } }]
        : []),
      { $count: "total" },
    ];

    const totalResult = await GPOModel.aggregate(totalPipeline);
    const total = totalResult[0]?.total || 0;

    res.status(200).json({
      success: true,
      data: gpos,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: "Failed to retrieve GPOs and deals data",
      error: error.message,
    });
  }
};
