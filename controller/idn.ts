import type { Request, Response } from "express";
import type { AuthRequest } from "../middleware/authMiddleware.ts";
import IDN from "../model/Idn.ts";
import Deal from "../model/deal.ts";
import Hospital from "../model/Hospital.ts";
import Product from "../model/Product.ts";
import mongoose from "mongoose";
import { UserRole } from "../model/User.ts";

export const GetIDNNameIDS = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const idns = await IDN.find({}, "_id name");

    const formattedIDNs = idns.reduce(
      (acc: Record<string, string>, idn: any) => {
        acc[idn.name] = idn._id.toString();
        return acc;
      },
      {},
    );

    res.status(200).json(formattedIDNs);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch IDNs",
      error,
    });
  }
};

export const getIDNHospitalDealsbyID = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const idnId = req.query.idnId as string;
    if (!idnId || !mongoose.Types.ObjectId.isValid(idnId)) {
      res
        .status(400)
        .json({ success: false, message: "Invalid or missing idnId" });
      return;
    }

    const page = parseInt((req.query.page as string) || "1", 10) || 1;
    const limit = parseInt((req.query.limit as string) || "10", 10) || 10;
    const skip = (page - 1) * limit;

    const isPrivileged =
      req.user?.role === UserRole.ADMIN ||
      req.user?.role === UserRole.EXECUTIVE ||
      req.user?.role === UserRole.CUSTOMER_SUCCESS;

    const hospitalId = req.query.hospitalId as string | undefined;
    const productId = req.query.productId as string | undefined;

    const hospitalMatch: any = { idn: new mongoose.Types.ObjectId(idnId) };
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
          let: { hospitalId: "$_id" },
          pipeline: [
            { $match: { $expr: { $eq: ["$hospital", "$$hospitalId"] } } },
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
                quantity: "$products.quantity",
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
        { $group: { _id: "$_id" } },
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
    res
      .status(500)
      .json({
        success: false,
        message: "Failed to get IDN hospital deals",
        error: error.message,
      });
  }
};

export const getIDNs = async (req: Request, res: Response): Promise<void> => {
  try {
    // Query params
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const search = (req.query.search as string) || "";

    const skip = (page - 1) * limit;

    // Search query (adjust fields based on your schema)
    const searchQuery = search
      ? {
          $or: [{ name: { $regex: search, $options: "i" } }],
        }
      : {};

    // Fetch IDNs
    const idns = await IDN.find(searchQuery)
      .select("-createdAt -updatedAt -__v -hospitals")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await IDN.countDocuments(searchQuery);

    res.status(200).json({
      success: true,
      page,
      limit,
      totalIDNs: total,
      totalPages: Math.ceil(total / limit),
      data: idns,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: "Failed to retrieve IDNs",
      error: error.message,
    });
  }
};

export const getIDNById = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { id } = req.params;
    if (typeof id !== "string") {
      res.status(400).json({ success: false, message: "Invalid ID" });
      return;
    }

    const idn = await IDN.findById(id).populate("hospitals");

    if (!idn) {
      res.status(404).json({
        success: false,
        message: "IDN not found",
      });
      return;
    }

    res.status(200).json({
      success: true,
      data: idn,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: "Error fetching IDN",
      error: error.message,
    });
  }
};

export const createIDN = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const idnData = {
      ...req.body,
      user: req.user?._id,
    };

    const idn = new IDN(idnData);
    await idn.save();

    res.status(201).json({
      success: true,
      data: idn,
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: "Failed to create IDN",
      error: error.message,
    });
  }
};

export const deleteIDN = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    if (typeof id !== "string") {
      res.status(400).json({ success: false, message: "Invalid ID" });
      return;
    }

    const idn = await IDN.findByIdAndDelete(id);

    if (!idn) {
      res.status(404).json({ success: false, message: "IDN not found" });
      return;
    }

    res
      .status(200)
      .json({ success: true, message: "IDN deleted successfully" });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: "Error deleting IDN",
      error: error.message,
    });
  }
};

export const updateIDN = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    if (typeof id !== "string") {
      res.status(400).json({ success: false, message: "Invalid ID" });
      return;
    }

    const updatedIDN = await IDN.findByIdAndUpdate(id, req.body, {
      new: true,
      runValidators: true,
    });

    if (!updatedIDN) {
      res.status(404).json({ success: false, message: "IDN not found" });
      return;
    }

    res.status(200).json({
      success: true,
      data: updatedIDN,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: "Failed to update IDN",
      error: error.message,
    });
  }
};

export const getAllIDNsDeals00 = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const search = (req.query.search as string) || "";
    const userId = req.query.userId as string;

    const skip = (page - 1) * limit;

    // ✅ Safe ObjectId
    const userObjectId =
      userId && mongoose.Types.ObjectId.isValid(userId)
        ? new mongoose.Types.ObjectId(userId)
        : null;

    const matchStage: any = {};
    if (search) {
      matchStage.name = { $regex: search, $options: "i" };
    }

    const pipeline: any[] = [
      { $match: matchStage },

      // 🔥 STEP 1: Hospitals lookup (dynamic based on user)
      {
        $lookup: {
          from: "hospitals",
          let: { idnId: "$_id" },
          pipeline: [
            {
              $match: {
                $expr: userObjectId
                  ? {
                      $and: [
                        { $eq: ["$idn", "$$idnId"] },
                        { $eq: ["$user", userObjectId] },
                      ],
                    }
                  : {
                      $eq: ["$idn", "$$idnId"],
                    },
              },
            },
            {
              $lookup: {
                from: "gpos",
                localField: "gpo",
                foreignField: "_id",
                as: "gpo",
              },
            },
            { $unwind: { path: "$gpo", preserveNullAndEmptyArrays: true } },
          ],
          as: "hospitals",
        },
      },

      // 🔥 STEP 2: Remove empty IDNs ONLY if userId exists
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

      // 🔥 STEP 4: Deals lookup
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
            {
              $lookup: {
                from: "products",
                localField: "products.product",
                foreignField: "_id",
                as: "product",
              },
            },
            { $unwind: { path: "$product", preserveNullAndEmptyArrays: true } },
          ],
          as: "deals",
        },
      },

      // 🔥 STEP 5: Hospital-level aggregation
      {
        $addFields: {
          hospitals: {
            $map: {
              input: "$hospitals",
              as: "h",
              in: {
                _id: "$$h._id",
                hospitalName: "$$h.hospitalName",
                gpo: "$$h.gpo",
                city: "$$h.city",
                state: "$$h.state",
                zip: "$$h.zip",

                totalExpectedARR: {
                  $sum: {
                    $map: {
                      input: {
                        $filter: {
                          input: "$deals",
                          as: "d",
                          cond: { $eq: ["$$d.hospital", "$$h._id"] },
                        },
                      },
                      as: "d",
                      in: { $ifNull: ["$$d.products.dealAmount", 0] },
                    },
                  },
                },

                expectedARRByProduct: {
                  $map: {
                    input: {
                      $setUnion: [
                        {
                          $map: {
                            input: {
                              $filter: {
                                input: "$deals",
                                as: "d",
                                cond: { $eq: ["$$d.hospital", "$$h._id"] },
                              },
                            },
                            as: "d",
                            in: "$$d.product.name",
                          },
                        },
                      ],
                    },
                    as: "productName",
                    in: {
                      name: "$$productName",
                      amount: {
                        $sum: {
                          $map: {
                            input: {
                              $filter: {
                                input: "$deals",
                                as: "d",
                                cond: {
                                  $and: [
                                    { $eq: ["$$d.hospital", "$$h._id"] },
                                    {
                                      $eq: [
                                        "$$d.product.name",
                                        "$$productName",
                                      ],
                                    },
                                  ],
                                },
                              },
                            },
                            as: "d",
                            in: { $ifNull: ["$$d.products.dealAmount", 0] },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },

      // 🔥 STEP 6: IDN total ARR
      {
        $addFields: {
          idnTotalExpectedARR: {
            $sum: "$deals.products.dealAmount",
          },
        },
      },

      // 🔥 STEP 7: IDN product grouping
      {
        $addFields: {
          idnARRByProduct: {
            $map: {
              input: {
                $setUnion: [
                  {
                    $map: {
                      input: "$deals",
                      as: "d",
                      in: "$$d.product.name",
                    },
                  },
                ],
              },
              as: "productName",
              in: {
                name: "$$productName",
                amount: {
                  $sum: {
                    $map: {
                      input: "$deals",
                      as: "d",
                      in: {
                        $cond: [
                          { $eq: ["$$d.product.name", "$$productName"] },
                          { $ifNull: ["$$d.products.dealAmount", 0] },
                          0,
                        ],
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },

      // 🔥 STEP 8: Total hospitals
      {
        $addFields: {
          totalHospitals: { $size: "$hospitals" },
        },
      },

      {
        $project: {
          deals: 0,
          hospitalIds: 0,
        },
      },

      { $sort: { createdAt: -1 } },
      { $skip: skip },
      { $limit: limit },
    ];

    const idns = await IDN.aggregate(pipeline);

    // ✅ Pagination count
    const totalPipeline: any[] = [
      { $match: matchStage },
      {
        $lookup: {
          from: "hospitals",
          let: { idnId: "$_id" },
          pipeline: [
            {
              $match: {
                $expr: userObjectId
                  ? {
                      $and: [
                        { $eq: ["$idn", "$$idnId"] },
                        { $eq: ["$user", userObjectId] },
                      ],
                    }
                  : {
                      $eq: ["$idn", "$$idnId"],
                    },
              },
            },
          ],
          as: "hospitals",
        },
      },
      ...(userObjectId
        ? [
            {
              $match: {
                "hospitals.0": { $exists: true },
              },
            },
          ]
        : []),
      { $count: "total" },
    ];

    const totalResult = await IDN.aggregate(totalPipeline);
    const total = totalResult[0]?.total || 0;

    res.status(200).json({
      success: true,
      data: idns,
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
      message: "Failed to retrieve IDNs and deals data",
      error: error.message,
    });
  }
};

export const getAllIDNsDeals = async (
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

      // 🔥 STEP 1: Hospitals lookup (dynamic based on user)
      {
        $lookup: {
          from: "hospitals",
          let: { idnId: "$_id" },
          pipeline: [
            {
              $match: {
                $expr: userObjectId
                  ? {
                      $and: [
                        { $eq: ["$idn", "$$idnId"] },
                        { $eq: ["$user", userObjectId] },
                      ],
                    }
                  : {
                      $eq: ["$idn", "$$idnId"],
                    },
              },
            },
            {
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
                      name: 1,
                      _id: 0,
                    },
                  },
                ],
                as: "gpo",
              },
            },
            { $unwind: { path: "$gpo", preserveNullAndEmptyArrays: true } },
          ],
          as: "hospitals",
        },
      },

      // 🔥 STEP 2: Remove empty IDNs ONLY if userId exists
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

      // 🔥 STEP 4: Deals lookup
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
            {
              $lookup: {
                from: "products",
                localField: "products.product",
                foreignField: "_id",
                as: "product",
              },
            },
            { $unwind: { path: "$product", preserveNullAndEmptyArrays: true } },
          ],
          as: "deals",
        },
      },

      // 🔥 STEP 5: Hospital-level aggregation
      {
        $addFields: {
          hospitals: {
            $map: {
              input: "$hospitals",
              as: "h",
              in: {
                _id: "$$h._id",
                hospitalName: "$$h.hospitalName",
                gpo: "$$h.gpo",
                city: "$$h.city",
                state: "$$h.state",
                zip: "$$h.zip",

                totalExpectedARR: {
                  $sum: {
                    $map: {
                      input: {
                        $filter: {
                          input: "$deals",
                          as: "d",
                          cond: { $eq: ["$$d.hospital", "$$h._id"] },
                        },
                      },
                      as: "d",
                      in: { $ifNull: ["$$d.products.dealAmount", 0] },
                    },
                  },
                },

                expectedARRByProduct: {
                  $map: {
                    input: {
                      $setUnion: [
                        {
                          $map: {
                            input: {
                              $filter: {
                                input: "$deals",
                                as: "d",
                                cond: { $eq: ["$$d.hospital", "$$h._id"] },
                              },
                            },
                            as: "d",
                            in: "$$d.product.name",
                          },
                        },
                      ],
                    },
                    as: "productName",
                    in: {
                      name: "$$productName",
                      amount: {
                        $sum: {
                          $map: {
                            input: {
                              $filter: {
                                input: "$deals",
                                as: "d",
                                cond: {
                                  $and: [
                                    { $eq: ["$$d.hospital", "$$h._id"] },
                                    {
                                      $eq: [
                                        "$$d.product.name",
                                        "$$productName",
                                      ],
                                    },
                                  ],
                                },
                              },
                            },
                            as: "d",
                            in: { $ifNull: ["$$d.products.dealAmount", 0] },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },

      // 🔥 STEP 6: IDN total ARR
      {
        $addFields: {
          idnTotalExpectedARR: {
            $sum: "$deals.products.dealAmount",
          },
        },
      },

      // 🔥 STEP 7: IDN product grouping
      {
        $addFields: {
          idnARRByProduct: {
            $map: {
              input: {
                $setUnion: [
                  {
                    $map: {
                      input: "$deals",
                      as: "d",
                      in: "$$d.product.name",
                    },
                  },
                ],
              },
              as: "productName",
              in: {
                name: "$$productName",
                amount: {
                  $sum: {
                    $map: {
                      input: "$deals",
                      as: "d",
                      in: {
                        $cond: [
                          { $eq: ["$$d.product.name", "$$productName"] },
                          { $ifNull: ["$$d.products.dealAmount", 0] },
                          0,
                        ],
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },

      // 🔥 STEP 8: Total hospitals
      {
        $addFields: {
          totalHospitals: { $size: "$hospitals" },
        },
      },

      {
        $project: {
          deals: 0,
          createdAt: 0,
          updatedAt: 0,
          __v: 0,
        },
      },

      { $sort: { createdAt: -1 } },
      { $skip: skip },
      { $limit: limit },
    ];

    const idns = await IDN.aggregate(pipeline);

    // ✅ Pagination count
    const totalPipeline: any[] = [
      { $match: matchStage },
      {
        $lookup: {
          from: "hospitals",
          let: { idnId: "$_id" },
          pipeline: [
            {
              $match: {
                $expr: userObjectId
                  ? {
                      $and: [
                        { $eq: ["$idn", "$$idnId"] },
                        { $eq: ["$user", userObjectId] },
                      ],
                    }
                  : {
                      $eq: ["$idn", "$$idnId"],
                    },
              },
            },
          ],
          as: "hospitals",
        },
      },
      ...(userObjectId
        ? [
            {
              $match: {
                "hospitals.0": { $exists: true },
              },
            },
          ]
        : []),
      { $count: "total" },
    ];

    const totalResult = await IDN.aggregate(totalPipeline);
    const total = totalResult[0]?.total || 0;

    res.status(200).json({
      success: true,
      data: idns,
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
      message: "Failed to retrieve IDNs and deals data",
      error: error.message,
    });
  }
};
