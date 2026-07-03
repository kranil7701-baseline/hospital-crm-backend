import type { Request, Response } from "express";
import type { AuthRequest } from "../middleware/authMiddleware.ts";
import Task from "../model/Task.ts";
import Notes from "../model/Notes.ts";
import CallLogs from "../model/CallLogs.ts";
import Hospital from "../model/Hospital.ts";
import mongoose from "mongoose";
import dotenv from "dotenv";
import { handleMentions } from "../helper/mentionNotification.ts";
import { UserRole } from "../model/User.ts";


dotenv.config();

export const getDashboardActivity = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const userId = req.user?._id;
    const userRole = req.user?.role;

    if (!userId) {
      res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
      return;
    }

    const objectUserId = new mongoose.Types.ObjectId(userId);

    // 🔥 Check role
    const isAdminOrExecutive = userRole === "Admin" || userRole === "Executive";

    let mentionRegexPattern = "";
    if (userId && req.user?.email) {
      const userEmail = req.user.email;
      const emailEscaped = userEmail.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      mentionRegexPattern = `(?:^|\\s)@${emailEscaped}(?:\\b|\\s|$)`;
    }

    const noteMatchStage = isAdminOrExecutive
      ? {}
      : (mentionRegexPattern
        ? {
          $or: [
            { user: objectUserId },
            { notes: { $regex: mentionRegexPattern, $options: "i" } },
          ],
        }
        : { user: objectUserId });

    const callLogMatchStage = isAdminOrExecutive ? {} : { user: objectUserId };

    const pipeline: any[] = [
      { $match: noteMatchStage },

      {
        $addFields: {
          activityType: "note",
        },
      },

      {
        $unionWith: {
          coll: "calllogs",

          pipeline: [
            { $match: callLogMatchStage },

            {
              $addFields: {
                activityType: "callLog",
              },
            },
          ],
        },
      },

      { $sort: { createdAt: -1 } },

      { $limit: 5 },

      {
        $lookup: {
          from: "hospitals",

          localField: "hospital",
          foreignField: "_id",

          pipeline: [
            {
              $project: {
                hospitalName: 1,
              },
            },
          ],

          as: "hospital",
        },
      },

      {
        $unwind: {
          path: "$hospital",
          preserveNullAndEmptyArrays: true,
        },
      },

      {
        $lookup: {
          from: "contacts",

          localField: "contact",
          foreignField: "_id",

          pipeline: [
            {
              $project: {
                firstName: 1,
                lastName: 1,
              },
            },
          ],

          as: "contact",
        },
      },

      {
        $unwind: {
          path: "$contact",
          preserveNullAndEmptyArrays: true,
        },
      },

      {
        $lookup: {
          from: "products",
          localField: "products",
          foreignField: "_id",
          as: "products",
        },
      },
    ];

    const combinedActivities = await Notes.aggregate(pipeline);

    res.status(200).json({
      success: true,
      data: combinedActivities,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch dashboard activities",
      error: error.message,
    });
  }
};

export const getActivities = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const hospitalId = req.query.hospitalId as string;
    const userId = req.query.userId as string;
    const productId = req.query.productId as string;

    // ✅ Pagination
    const page = parseInt(req.query.page as string) || 1;

    const limit = parseInt(req.query.limit as string) || 20;

    const skip = (page - 1) * limit;

    // ✅ Filters
    const filter: any = {};

    // ✅ Last 30 Days Activities Only (optional)
    if (!req.query.showAll) {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      filter.createdAt = { $gte: thirtyDaysAgo };
    }

    if (hospitalId) {
      filter.hospital = new mongoose.Types.ObjectId(hospitalId);
    }

    if (userId) {
      filter.user = new mongoose.Types.ObjectId(userId);
    }

    if (productId && mongoose.Types.ObjectId.isValid(productId)) {
      filter.products = new mongoose.Types.ObjectId(productId);
    }

    const pipeline: any[] = [
      // ================= TASKS =================
      { $match: filter },

      {
        $addFields: {
          activityType: "task",
        },
      },

      // ================= NOTES =================
      {
        $unionWith: {
          coll: "notes",

          pipeline: [
            { $match: filter },

            {
              $addFields: {
                activityType: "note",
              },
            },
          ],
        },
      },

      // ================= CALL LOGS =================
      {
        $unionWith: {
          coll: "calllogs",

          pipeline: [
            { $match: filter },

            {
              $addFields: {
                activityType: "callLog",
              },
            },
          ],
        },
      },

      // ================= SORT =================
      {
        $sort: {
          createdAt: -1,
        },
      },

      // ================= FACET =================
      {
        $facet: {
          data: [
            { $skip: skip },

            { $limit: limit },

            // 🔥 Hospital Populate
            {
              $lookup: {
                from: "hospitals",

                localField: "hospital",

                foreignField: "_id",

                pipeline: [
                  {
                    $project: {
                      hospitalName: 1,
                    },
                  },
                ],

                as: "hospital",
              },
            },

            {
              $unwind: {
                path: "$hospital",
                preserveNullAndEmptyArrays: true,
              },
            },

            // 🔥 Contact Populate
            {
              $lookup: {
                from: "contacts",

                localField: "contact",

                foreignField: "_id",

                pipeline: [
                  {
                    $project: {
                      firstName: 1,
                      lastName: 1,
                    },
                  },
                ],

                as: "contact",
              },
            },

            {
              $unwind: {
                path: "$contact",
                preserveNullAndEmptyArrays: true,
              },
            },
            {
              $lookup: {
                from: "products",
                localField: "products",
                foreignField: "_id",
                as: "products",
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
            {
              $unwind: {
                path: "$user",
                preserveNullAndEmptyArrays: true,
              },
            },

            {
              $lookup: {
                from: "users",
                localField: "secondaryAssignees",
                foreignField: "_id",
                as: "secondaryAssignees",
              },
            },
          ],

          totalCount: [
            {
              $count: "total",
            },
          ],
        },
      },
    ];

    const result = await Task.aggregate(pipeline);

    const activities = result[0]?.data || [];

    const total = result[0]?.totalCount?.[0]?.total || 0;

    res.status(200).json({
      success: true,

      page,
      limit,

      total,

      totalPages: Math.ceil(total / limit),

      data: activities,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: "Failed to aggregate activities",
      error: error.message,
    });
  }
};

export const deleteActivity = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const { id, type } = req.body;

    if (!id || !type) {
      res.status(400).json({
        success: false,
        message: "ID and type are required",
      });
      return;
    }

    let model;

    switch (type.toLowerCase()) {
      case "task":
        model = Task;
        break;

      case "note":
        model = Notes;
        break;

      case "calllog":
        model = CallLogs;
        break;

      default:
        res.status(400).json({
          success: false,
          message: "Invalid activity type",
        });
        return;
    }

    // Admin can delete any activity
    // Other users can delete only their own or if they are the hospital's assigned user
    const activity = await (model as any).findById(id);

    if (!activity) {
      res.status(404).json({
        success: false,
        message: "Activity not found",
      });
      return;
    }

    const isPrivileged = req.user?.role === UserRole.ADMIN || req.user?.role === UserRole.CUSTOMER_SUCCESS;
    if (!isPrivileged) {
      const isCreator = activity.user?.toString() === req.user?._id?.toString();
      let isHospitalUser = false;
      if (activity.hospital) {
        const hospital = await Hospital.findById(activity.hospital);
        isHospitalUser = hospital?.user?.toString() === req.user?._id?.toString();
      }
      const isSecondaryAssignee = (activity.secondaryAssignees || []).some(
        (id: any) => id.toString() === req.user?._id?.toString()
      );
      if (!isCreator && !isHospitalUser && !isSecondaryAssignee) {
        res.status(403).json({
          success: false,
          message: "You don't have permission to delete this activity",
        });
        return;
      }
    }

    await (model as any).findByIdAndDelete(id);

    res.status(200).json({
      success: true,
      message: `${type} deleted successfully`,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: "Failed to delete activity",
      error: error.message,
    });
  }
};

export const createActivity = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const { type, data } = req.body;

    if (!type || !data) {
      res.status(400).json({
        success: false,
        message: "Type and data are required",
      });
      return;
    }

    let model;

    let populateOptions: any = [
      {
        path: "hospital",
        select: "hospitalName",
      },
      {
        path: "products",
        select: "name",
      },
      {
        path: "user",
        select: "name email",
      },
    ];

    switch (type.toLowerCase()) {
      case "task":
        model = Task;
        populateOptions.push(
          { path: "secondaryAssignees", select: "name email" },
        );
        break;

      case "note":
        model = Notes;
        break;

      case "calllog":
        model = CallLogs;

        // ✅ Contact populate only if contact exists
        if (data.contact && data.contact !== "") {
          populateOptions.push({
            path: "contact",
            select: "firstName lastName",
          });
        }

        break;

      default:
        res.status(400).json({
          success: false,
          message: "Invalid activity type",
        });
        return;
    }

    // ✅ Validate Product Category Deal exists for this Hospital
    if (!data.hospital) {
      res.status(400).json({
        success: false,
        message: "Hospital ID is required",
      });
      return;
    }

    if (data.products && Array.isArray(data.products) && data.products.length > 0) {
      const Product = mongoose.model("Product");
      for (const pid of data.products) {
        if (!mongoose.Types.ObjectId.isValid(pid)) {
          res.status(400).json({
            success: false,
            message: "Invalid Product Category ID",
          });
          return;
        }
        const productExists = await Product.findById(pid);
        if (!productExists) {
          res.status(400).json({
            success: false,
            message: "Selected Product Category does not exist.",
          });
          return;
        }
      }
    } else {
      res.status(400).json({
        success: false,
        message: "At least one Product Category is required.",
      });
      return;
    }

    // ✅ Activity Data
    const activityData: any = {
      ...data,
      user: data.user || (req as any).user?._id,
    };

    // ✅ Remove empty contact field
    if (
      type.toLowerCase() === "calllog" &&
      (!activityData.contact || activityData.contact === "")
    ) {
      delete activityData.contact;
    }

    // ✅ Mention detection
    if (type.toLowerCase() === "note" || type.toLowerCase() === "task") {
      const textToSearch = type.toLowerCase() === "note"
        ? (data.notes || data.note || "")
        : `${data.title || ""} ${data.description || ""}`;
      await handleMentions(req, textToSearch, type, data.hospital);
    }

    // ✅ Create Activity
    const newActivity = new (model as any)(activityData);

    await newActivity.save();

    await newActivity.populate(populateOptions);

    res.status(201).json({
      success: true,
      message: `${type} created successfully`,
      data: newActivity,
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: `Failed to create ${req.body.type || "activity"}`,
      error: error.message,
    });
  }
};

export const updateActivity = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const { id, type, data } = req.body;

    if (!id || !type || !data) {
      res.status(400).json({
        success: false,
        message: "ID, type, and data are required",
      });
      return;
    }

    let model;
    let populateOptions: any = [
      {
        path: "hospital",
        select: "hospitalName",
      },
      {
        path: "products",
        select: "name",
      },
      {
        path: "user",
        select: "name email",
      },
    ];

    switch (type.toLowerCase()) {
      case "task":
        model = Task;
        populateOptions.push(
          { path: "secondaryAssignees", select: "name email" },
        );
        break;

      case "note":
        model = Notes;
        break;

      case "calllog":
        model = CallLogs;
        if (data.contact && data.contact !== "") {
          populateOptions.push({
            path: "contact",
            select: "firstName lastName",
          });
        }
        break;

      default:
        res.status(400).json({
          success: false,
          message: "Invalid activity type",
        });
        return;
    }

    // ✅ Validate activity exists and check permissions
    const existingActivity = await (model as any).findById(id);
    if (!existingActivity) {
      res.status(404).json({
        success: false,
        message: "Activity not found",
      });
      return;
    }

    const isPrivileged = req.user?.role === UserRole.ADMIN || req.user?.role === UserRole.CUSTOMER_SUCCESS;
    if (!isPrivileged) {
      const isCreator = existingActivity.user?.toString() === req.user?._id?.toString();
      let isHospitalUser = false;
      if (existingActivity.hospital) {
        const hospital = await Hospital.findById(existingActivity.hospital);
        isHospitalUser = hospital?.user?.toString() === req.user?._id?.toString();
      }
      const isSecondaryAssignee = (existingActivity.secondaryAssignees || []).some(
        (id: any) => id.toString() === req.user?._id?.toString()
      );
      if (!isCreator && !isHospitalUser && !isSecondaryAssignee) {
        res.status(403).json({
          success: false,
          message: "You don't have permission to update this activity",
        });
        return;
      }
    }
    const targetHospitalId = data.hospital || existingActivity.hospital;

    if (data.products && Array.isArray(data.products) && data.products.length > 0) {
      const Product = mongoose.model("Product");
      for (const pid of data.products) {
        if (!mongoose.Types.ObjectId.isValid(pid)) {
          res.status(400).json({
            success: false,
            message: "Invalid Product Category ID",
          });
          return;
        }
        const productExists = await Product.findById(pid);
        if (!productExists) {
          res.status(400).json({
            success: false,
            message: "Selected Product Category does not exist.",
          });
          return;
        }
      }
    } else {
      res.status(400).json({
        success: false,
        message: "At least one Product Category is required.",
      });
      return;
    }

    if (type.toLowerCase() === "note" || type.toLowerCase() === "task") {
      const textToSearch = type.toLowerCase() === "note"
        ? (data.notes || data.note || "")
        : `${data.title || ""} ${data.description || ""}`;
      await handleMentions(req, textToSearch, type, data.hospital);
    }

    const cleanData = Object.fromEntries(
      Object.entries(data).filter(([, v]) => v !== undefined && v !== ""),
    );

    const updatedActivity = await (model as any).findByIdAndUpdate(id, cleanData, {
      new: true,
      runValidators: true,
    }).populate(populateOptions);

    if (!updatedActivity) {
      res.status(404).json({
        success: false,
        message: "Activity not found or you don't have permission to update it",
      });
      return;
    }

    res.status(200).json({
      success: true,
      message: `${type} updated successfully`,
      data: updatedActivity,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: "Failed to update activity",
      error: error.message,
    });
  }
};
