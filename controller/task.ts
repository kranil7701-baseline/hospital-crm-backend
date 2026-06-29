import type { Request, Response } from "express";
import type { AuthRequest } from "../middleware/authMiddleware.ts";
import Task from "../model/Task.ts";
import User from "../model/User.ts";
import mongoose from "mongoose";
import { handleMentions } from "../helper/mentionNotification.ts";

export const getDashboardTasks = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const search = (req.query.search as string) || "";
    const userId = req.user?._id;
    const userRole = req.user?.role;

    if (!userId) {
      res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
      return;
    }

    const isAdminOrExecutive = userRole === "Admin" || userRole === "Executive";

    const skip = (page - 1) * limit;

    const matchStage: any = {};

    let mentionRegexPattern = "";
    if (userId && req.user?.email) {
      const userEmail = req.user.email;
      const emailEscaped = userEmail.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      mentionRegexPattern = `(?:^|\\s)@${emailEscaped}(?:\\b|\\s|$)`;
    }

    if (!isAdminOrExecutive && userId) {
      const userObjectId = new mongoose.Types.ObjectId(userId);
      const orConditions: any[] = [
        { user: userObjectId },
        { secondaryAssignees: userObjectId }
      ];
      if (mentionRegexPattern) {
        orConditions.push(
          { title: { $regex: mentionRegexPattern, $options: "i" } },
          { description: { $regex: mentionRegexPattern, $options: "i" } }
        );
      }
      matchStage.$or = orConditions;
    }

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    matchStage.createdAt = {
      $gte: sevenDaysAgo,
    };

    if (search) {
      if (matchStage.$or) {
        const userOrMentions = matchStage.$or;
        delete matchStage.$or;
        matchStage.$and = [
          { $or: userOrMentions },
          {
            $or: [
              { title: { $regex: search, $options: "i" } },
              { description: { $regex: search, $options: "i" } },
            ],
          },
        ];
      } else {
        matchStage.$or = [
          {
            title: {
              $regex: search,
              $options: "i",
            },
          },
          {
            description: {
              $regex: search,
              $options: "i",
            },
          },
        ];
      }
    }

    const pipeline: any[] = [
      { $match: matchStage },

      {
        $lookup: {
          from: "hospitals",
          let: { hospitalId: "$hospital" },

          pipeline: [
            {
              $match: {
                $expr: {
                  $eq: ["$_id", "$$hospitalId"],
                },
              },
            },
            {
              $project: {
                _id: 1,
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
          from: "products",
          localField: "product",
          foreignField: "_id",
          as: "product",
        },
      },
      { $unwind: { path: "$product", preserveNullAndEmptyArrays: true } },

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
        $lookup: {
          from: "users",
          localField: "secondaryAssignees",
          foreignField: "_id",
          as: "secondaryAssignees",
        },
      },

      { $sort: { createdAt: -1 } },

      {
        $facet: {
          data: [{ $skip: skip }, { $limit: limit }],

          totalCount: [{ $count: "total" }],
        },
      },
    ];

    const result = await Task.aggregate(pipeline);

    const tasks = result[0]?.data || [];
    const total = result[0]?.totalCount[0]?.total || 0;

    res.status(200).json({
      success: true,
      page,
      limit,
      totalTasks: total,
      totalPages: Math.ceil(total / limit),
      data: tasks,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: "Failed to retrieve dashboard tasks",
      error: error.message,
    });
  }
};

export const getTasks = async (req: Request, res: Response): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const search = (req.query.search as string) || "";
    const userId = req.query.userId as string;
    const hospitalId = req.query.hospitalId as string;
    const productId = req.query.productId as string;

    const skip = (page - 1) * limit;
    const matchStage: any = {};

    let mentionRegexPattern = "";
    if (userId) {
      const targetUser = await User.findById(userId);
      if (targetUser && targetUser.email) {
        const emailEscaped = targetUser.email.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
        mentionRegexPattern = `(?:^|\\s)@${emailEscaped}(?:\\b|\\s|$)`;
      }
    }

    if (userId) {
      const userObjectId = new mongoose.Types.ObjectId(userId);
      const orConditions: any[] = [
        { user: userObjectId },
        { secondaryAssignees: userObjectId }
      ];
      if (mentionRegexPattern) {
        orConditions.push(
          { title: { $regex: mentionRegexPattern, $options: "i" } },
          { description: { $regex: mentionRegexPattern, $options: "i" } }
        );
      }
      matchStage.$or = orConditions;
    }

    if (hospitalId) {
      matchStage.hospital = new mongoose.Types.ObjectId(hospitalId);
    }

    if (productId && mongoose.Types.ObjectId.isValid(productId)) {
      matchStage.product = new mongoose.Types.ObjectId(productId);
    }

    if (search) {
      if (matchStage.$or) {
        const userOrMentions = matchStage.$or;
        delete matchStage.$or;
        matchStage.$and = [
          { $or: userOrMentions },
          {
            $or: [
              { title: { $regex: search, $options: "i" } },
              { description: { $regex: search, $options: "i" } },
            ],
          },
        ];
      } else {
        matchStage.$or = [
          { title: { $regex: search, $options: "i" } },
          { description: { $regex: search, $options: "i" } },
        ];
      }
    }

    const pipeline: any[] = [
      { $match: matchStage },

      // ✅ Optimized lookup
      {
        $lookup: {
          from: "hospitals",
          let: { hospitalId: "$hospital" },
          pipeline: [
            {
              $match: {
                $expr: { $eq: ["$_id", "$$hospitalId"] },
              },
            },
            {
              $project: {
                _id: 1,
                hospitalName: 1,
              },
            },
          ],
          as: "hospital",
        },
      },

      { $unwind: { path: "$hospital", preserveNullAndEmptyArrays: true } },

      {
        $lookup: {
          from: "products",
          localField: "product",
          foreignField: "_id",
          as: "product",
        },
      },
      { $unwind: { path: "$product", preserveNullAndEmptyArrays: true } },

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
        $lookup: {
          from: "users",
          localField: "secondaryAssignees",
          foreignField: "_id",
          as: "secondaryAssignees",
        },
      },

      { $sort: { dueDate: 1 } },

      {
        $facet: {
          data: [{ $skip: skip }, { $limit: limit }],
          totalCount: [{ $count: "total" }],
        },
      },
    ];

    const result = await Task.aggregate(pipeline);
    const tasks = result[0]?.data || [];
    const total = result[0]?.totalCount[0]?.total || 0;

    res.status(200).json({
      success: true,
      page,
      limit,
      totalTasks: total,
      totalPages: Math.ceil(total / limit),
      data: tasks,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: "Failed to retrieve tasks",
      error: error.message,
    });
  }
};

export const getTaskById = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { id } = req.params;
    const task = await Task.findById(id)
      .populate("hospital", "hospitalName")
      .populate("user", "name email")
      .populate("product", "name")
      .populate("secondaryAssignees", "name email");

    if (!task) {
      res.status(404).json({ success: false, message: "Task not found" });
      return;
    }

    res.status(200).json({ success: true, data: task });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: "Error fetching task",
      error: error.message,
    });
  }
};

export const createTask = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const taskData = {
      ...req.body,
      user: req.body.user || req.user?._id,
    };

    const newTask = new Task(taskData);
    await newTask.save();
    await newTask.populate([
      { path: "hospital", select: "hospitalName" },
      { path: "user", select: "name email" },
      { path: "product", select: "name" },
      { path: "secondaryAssignees", select: "name email" },
    ]);

    const taskText = `${req.body.title || ""} ${req.body.description || ""}`;
    await handleMentions(req, taskText, "task", req.body.hospital);

    res.status(201).json({ success: true, data: newTask });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: "Failed to create task",
      error: error.message,
    });
  }
};

export const updateTask = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const { id } = req.params;

    const existingTask = await Task.findById(id);
    if (!existingTask) {
      res.status(404).json({ success: false, message: "Task not found" });
      return;
    }

    if (req.user?.role === "Sales") {
      const isCreator = existingTask.user.toString() === req.user._id.toString();
      if (!isCreator && req.body.secondaryAssignees) {
        const existingSecs = (existingTask.secondaryAssignees || []).map(id => id.toString()).sort();
        const incomingSecs = (req.body.secondaryAssignees || []).map((id: string) => id.toString()).sort();
        if (JSON.stringify(existingSecs) !== JSON.stringify(incomingSecs)) {
          res.status(403).json({
            success: false,
            message: "Salespeople are not allowed to edit secondary assignees for tasks they did not create."
          });
          return;
        }
      }
    }

    const updatedTask = await Task.findByIdAndUpdate(id, req.body, {
      new: true,
      runValidators: true,
    }).populate([
      { path: "hospital", select: "hospitalName" },
      { path: "user", select: "name email" },
      { path: "product", select: "name" },
      { path: "secondaryAssignees", select: "name email" },
    ]);

    if (!updatedTask) {
      res.status(404).json({ success: false, message: "Task not found" });
      return;
    }

    const taskText = `${req.body.title || ""} ${req.body.description || ""}`;
    await handleMentions(req, taskText, "task", updatedTask.hospital?._id?.toString() || req.body.hospital);

    res.status(200).json({ success: true, data: updatedTask });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: "Failed to update task",
      error: error.message,
    });
  }
};

export const deleteTask = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { id } = req.params;
    const task = await Task.findByIdAndDelete(id);

    if (!task) {
      res.status(404).json({ success: false, message: "Task not found" });
      return;
    }

    res
      .status(200)
      .json({ success: true, message: "Task deleted successfully" });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: "Error deleting task",
      error: error.message,
    });
  }
};
