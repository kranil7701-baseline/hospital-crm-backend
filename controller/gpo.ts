import type { Request, Response } from 'express';
import type { AuthRequest } from '../middleware/authMiddleware.ts';
import GPOModel from '../model/Gpo.ts';
import Deal from '../model/deal.ts';
import Hospital from '../model/Hospital.ts';
import Product from '../model/Product.ts';
import mongoose from "mongoose";

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
        $or: [
          { name: { $regex: search, $options: "i" } },
        ]
      }
      : {};

    // Fetch GPOs
    const gpos = await GPOModel.find(searchQuery)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit).select("name");

    const total = await GPOModel.countDocuments(searchQuery);

    res.status(200).json({
      success: true,
      page,
      limit,
      totalGPOs: total,
      totalPages: Math.ceil(total / limit),
      data: gpos
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: "Failed to retrieve GPOs",
      error: error.message
    });
  }
};

export const getGPOById = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    if (typeof id !== 'string') {
      res.status(400).json({ success: false, message: 'Invalid ID' });
      return;
    }

    const gpo = await GPOModel.findById(id).select('name')

    if (!gpo) {
      res.status(404).json({
        success: false,
        message: 'GPO not found'
      });
      return;
    }

    res.status(200).json({
      success: true,
      data: gpo
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: 'Error fetching GPO',
      error: error.message
    });
  }
};

export const createGPO = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const gpoData = {
      ...req.body,
      user: req.user?._id
    };

    const gpo = new GPOModel(gpoData);
    await gpo.save();

    res.status(201).json({
      success: true,
      data: gpo
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: 'Failed to create GPO',
      error: error.message
    });
  }
};

export const deleteGPO = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    if (typeof id !== 'string') {
      res.status(400).json({ success: false, message: 'Invalid ID' });
      return;
    }

    const gpo = await GPOModel.findByIdAndDelete(id);

    if (!gpo) {
      res.status(404).json({ success: false, message: 'GPO not found' });
      return;
    }

    res.status(200).json({ success: true, message: 'GPO deleted successfully' });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Error deleting GPO', error: error.message });
  }
};

export const updateGPO = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    if (typeof id !== 'string') {
      res.status(400).json({ success: false, message: 'Invalid ID' });
      return;
    }

    const updatedGPO = await GPOModel.findByIdAndUpdate(
      id,
      req.body,
      { new: true, runValidators: true }
    );

    if (!updatedGPO) {
      res.status(404).json({ success: false, message: 'GPO not found' });
      return;
    }

    res.status(200).json({
      success: true,
      data: updatedGPO
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: 'Failed to update GPO',
      error: error.message
    });
  }
};


export const getAllGPODeals = async (req: Request, res: Response): Promise<void> => {
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

      // 🔥 STEP 1: Hospitals lookup (dynamic like IDN)
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
                      { $eq: ["$user", userObjectId] }
                    ]
                  }
                  : {
                    $eq: ["$gpo", "$$gpoId"]
                  }
              }
            },
            {
              $lookup: {
                from: "idns",
                localField: "idn",
                foreignField: "_id",
                as: "idn"
              }
            },
            { $unwind: { path: "$idn", preserveNullAndEmptyArrays: true } }
          ],
          as: "hospitals"
        }
      },

      // 🔥 STEP 2: Remove empty GPOs ONLY if userId exists
      ...(userObjectId
        ? [
          {
            $match: {
              "hospitals.0": { $exists: true }
            }
          }
        ]
        : []),

      // 🔥 STEP 3: Extract hospitalIds
      {
        $addFields: {
          hospitalIds: "$hospitals._id"
        }
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
                  $in: ["$hospital", "$$hospitalIds"]
                }
              }
            },
            { $unwind: "$products" },
            {
              $lookup: {
                from: "products",
                localField: "products.product",
                foreignField: "_id",
                as: "product"
              }
            },
            { $unwind: { path: "$product", preserveNullAndEmptyArrays: true } }
          ],
          as: "deals"
        }
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
                idn: "$$h.idn",
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
                          cond: { $eq: ["$$d.hospital", "$$h._id"] }
                        }
                      },
                      as: "d",
                      in: { $ifNull: ["$$d.products.dealAmount", 0] }
                    }
                  }
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
                                cond: { $eq: ["$$d.hospital", "$$h._id"] }
                              }
                            },
                            as: "d",
                            in: "$$d.product.name"
                          }
                        }
                      ]
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
                                    { $eq: ["$$d.product.name", "$$productName"] }
                                  ]
                                }
                              }
                            },
                            as: "d",
                            in: { $ifNull: ["$$d.products.dealAmount", 0] }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      },

      // 🔥 STEP 6: GPO totals
      {
        $addFields: {
          gpoTotalExpectedARR: {
            $sum: "$deals.products.dealAmount"
          }
        }
      },

      // 🔥 STEP 7: GPO product grouping
      {
        $addFields: {
          gpoARRByProduct: {
            $map: {
              input: {
                $setUnion: [
                  {
                    $map: {
                      input: "$deals",
                      as: "d",
                      in: "$$d.product.name"
                    }
                  }
                ]
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
                          0
                        ]
                      }
                    }
                  }
                }
              }
            }
          }
        }
      },

      {
        $addFields: {
          totalHospitals: { $size: "$hospitals" }
        }
      },

      {
        $project: {
          deals: 0,
          hospitalIds: 0
        }
      },

      { $sort: { createdAt: -1 } },
      { $skip: skip },
      { $limit: limit }
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
                      { $eq: ["$user", userObjectId] }
                    ]
                  }
                  : {
                    $eq: ["$gpo", "$$gpoId"]
                  }
              }
            }
          ],
          as: "hospitals"
        }
      },
      ...(userObjectId
        ? [{ $match: { "hospitals.0": { $exists: true } } }]
        : []),
      { $count: "total" }
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
        totalPages: Math.ceil(total / limit)
      }
    });

  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: "Failed to retrieve GPOs and deals data",
      error: error.message
    });
  }
};