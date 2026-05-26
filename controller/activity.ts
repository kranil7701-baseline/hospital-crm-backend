import type { Request, Response } from "express";
import type { AuthRequest } from "../middleware/authMiddleware.ts";
import Task from "../model/Task.ts";
import Notes from "../model/Notes.ts";
import CallLogs from "../model/CallLogs.ts";
import mongoose from "mongoose";
import { sendPushToUsers } from "./pushNotification.ts";
import User from "../model/User.ts";
import dotenv from "dotenv";
import { sendGraphEmail } from "../helper/graphEmail.ts";

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

    // 🔥 Dynamic match
    const matchStage = isAdminOrExecutive ? {} : { user: objectUserId };

    const pipeline: any[] = [
      { $match: matchStage },

      {
        $addFields: {
          activityType: "note",
        },
      },

      {
        $unionWith: {
          coll: "calllogs",

          pipeline: [
            { $match: matchStage },

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
    // Other users can delete only their own
    const query: any = {
      _id: new mongoose.Types.ObjectId(id),
    };

    if ((req as any).user?.role !== "Admin") {
      query.user = (req as any).user?._id;
    }

    const activity = await (model as any).findOneAndDelete(query);

    if (!activity) {
      res.status(404).json({
        success: false,
        message: "Activity not found or you don't have permission to delete it",
      });
      return;
    }

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
    ];

    switch (type.toLowerCase()) {
      case "task":
        model = Task;
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

    // ✅ Activity Data
    const activityData: any = {
      ...data,
      user: (req as any).user?._id,
    };

    // ✅ Remove empty contact field
    if (
      type.toLowerCase() === "calllog" &&
      (!activityData.contact || activityData.contact === "")
    ) {
      delete activityData.contact;
    }

    // ✅ Mention detection
    const textToSearch = data.notes || data.note || data.taskName || "";

    const mentions = textToSearch.match(/@([A-Za-z]+\s[A-Za-z]+)/g) || [];

    const cleanedMentions = mentions.map((m: string) =>
      m.replace("@", "").trim().toLowerCase(),
    );

    if (cleanedMentions.length > 0) {
      try {
        const validUsers = await User.find({
          name: {
            $in: cleanedMentions.map(
              (name: string) => new RegExp(`^${name}$`, "i"),
            ),
          },
        });

        const mentionedHospital = data.hospital;

        if (validUsers.length > 0) {
          const userIds = validUsers.map((u) => u._id.toString());

          await sendPushToUsers(userIds, {
            title: `${(req as any).user?.name} mentioned you in a ${type}`,

            message: textToSearch,

            url: `${process.env.FRONTEND_URL}/hospitals/${mentionedHospital}`,
          });

          // ✅ Email Notifications
          for (const user of validUsers) {
            if (user.email && (req as any).user?.email) {
              sendGraphEmail(
                (req as any).user.email,

                user.email,

                `${(req as any).user.name} mentioned you in a ${type}`,

                `<p>Hello ${user.name},</p>

                 <p>
                   <strong>${
                     (req as any).user.name
                   }</strong> mentioned you in a 
                   <strong>${type}</strong>:
                 </p>

                 <blockquote style="border-left: 4px solid #ccc; padding-left: 10px; margin: 10px 0;">
                   ${textToSearch}
                 </blockquote>

                 <p>
                   You can view it here:
                   <a href="${
                     process.env.FRONTEND_URL
                   }/hospitals/${mentionedHospital}">
                     ${process.env.FRONTEND_URL}/hospitals/${mentionedHospital}
                   </a>
                 </p>`,
              ).catch((err) =>
                console.error(`Failed to send email to ${user.email}`, err),
              );
            }
          }
        }
      } catch (err) {
        console.error("Error sending mention notifications", err);
      }
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
