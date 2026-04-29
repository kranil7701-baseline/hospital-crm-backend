import type { Request, Response } from 'express';
import type { AuthRequest } from '../middleware/authMiddleware.ts';
import IDN from '../model/Idn.ts';
import Deal from '../model/deal.ts';
import Hospital from '../model/Hospital.ts';
import Product from '../model/Product.ts';
import mongoose from "mongoose";

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
        $or: [
          { name: { $regex: search, $options: "i" } },
        ]
      }
      : {};

    // Fetch IDNs
    const idns = await IDN.find(searchQuery)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit).populate('hospitals');

    const total = await IDN.countDocuments(searchQuery);

    res.status(200).json({
      success: true,
      page,
      limit,
      totalIDNs: total,
      totalPages: Math.ceil(total / limit),
      data: idns
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: "Failed to retrieve IDNs",
      error: error.message
    });
  }
};

export const getIDNById = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    if (typeof id !== 'string') {
      res.status(400).json({ success: false, message: 'Invalid ID' });
      return;
    }

    const idn = await IDN.findById(id).populate('hospitals');

    if (!idn) {
      res.status(404).json({
        success: false,
        message: 'IDN not found'
      });
      return;
    }

    res.status(200).json({
      success: true,
      data: idn
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: 'Error fetching IDN',
      error: error.message
    });
  }
};

export const createIDN = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const idnData = {
      ...req.body,
      user: req.user?._id
    };

    const idn = new IDN(idnData);
    await idn.save();

    res.status(201).json({
      success: true,
      data: idn
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: 'Failed to create IDN',
      error: error.message
    });
  }
};

export const deleteIDN = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    if (typeof id !== 'string') {
      res.status(400).json({ success: false, message: 'Invalid ID' });
      return;
    }

    const idn = await IDN.findByIdAndDelete(id);

    if (!idn) {
      res.status(404).json({ success: false, message: 'IDN not found' });
      return;
    }

    res.status(200).json({ success: true, message: 'IDN deleted successfully' });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Error deleting IDN', error: error.message });
  }
};

export const updateIDN = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    if (typeof id !== 'string') {
      res.status(400).json({ success: false, message: 'Invalid ID' });
      return;
    }

    const updatedIDN = await IDN.findByIdAndUpdate(
      id,
      req.body,
      { new: true, runValidators: true }
    );

    if (!updatedIDN) {
      res.status(404).json({ success: false, message: 'IDN not found' });
      return;
    }

    res.status(200).json({
      success: true,
      data: updatedIDN
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: 'Failed to update IDN',
      error: error.message
    });
  }
};


export const getAllIDNsDeals = async (req: Request, res: Response): Promise<void> => {
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
                      { $eq: ["$user", userObjectId] }
                    ]
                  }
                  : {
                    $eq: ["$idn", "$$idnId"]
                  }
              }
            },
            {
              $lookup: {
                from: "gpos",
                localField: "gpo",
                foreignField: "_id",
                as: "gpo"
              }
            },
            { $unwind: { path: "$gpo", preserveNullAndEmptyArrays: true } }
          ],
          as: "hospitals"
        }
      },

      // 🔥 STEP 2: Remove empty IDNs ONLY if userId exists
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

      // 🔥 STEP 4: Deals lookup
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

      // 🔥 STEP 6: IDN total ARR
      {
        $addFields: {
          idnTotalExpectedARR: {
            $sum: "$deals.products.dealAmount"
          }
        }
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

      // 🔥 STEP 8: Total hospitals
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
                      { $eq: ["$user", userObjectId] }
                    ]
                  }
                  : {
                    $eq: ["$idn", "$$idnId"]
                  }
              }
            }
          ],
          as: "hospitals"
        }
      },
      ...(userObjectId
        ? [
          {
            $match: {
              "hospitals.0": { $exists: true }
            }
          }
        ]
        : []),
      { $count: "total" }
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
        totalPages: Math.ceil(total / limit)
      }
    });

  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: "Failed to retrieve IDNs and deals data",
      error: error.message
    });
  }
};