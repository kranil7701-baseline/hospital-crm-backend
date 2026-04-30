import type { Request, Response } from 'express';
import type { AuthRequest } from '../middleware/authMiddleware.ts';
import Task from '../model/Task.ts';
import mongoose from "mongoose";


export const getTasks = async (req: Request, res: Response): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const search = (req.query.search as string) || "";
    const userId = req.query.userId as string;
    const hospitalId = req.query.hospitalId as string;

    const skip = (page - 1) * limit;
    const matchStage: any = {};

    if (userId) {
      matchStage.user = new mongoose.Types.ObjectId(userId);
    }

    if (hospitalId) {
      matchStage.hospital = new mongoose.Types.ObjectId(hospitalId);
    }

    if (search) {
      matchStage.$or = [
        { title: { $regex: search, $options: "i" } },
        { description: { $regex: search, $options: "i" } }
      ];
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
                $expr: { $eq: ["$_id", "$$hospitalId"] }
              }
            },
            {
              $project: {
                _id: 1,
                hospitalName: 1
              }
            }
          ],
          as: "hospital"
        }
      },

      { $unwind: { path: "$hospital", preserveNullAndEmptyArrays: true } },

      { $sort: { dueDate: 1 } },

      {
        $facet: {
          data: [
            { $skip: skip },
            { $limit: limit }
          ],
          totalCount: [
            { $count: "total" }
          ]
        }
      }
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
      data: tasks
    });

  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: "Failed to retrieve tasks",
      error: error.message
    });
  }
};

export const getTaskById = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const task = await Task.findById(id).populate('hospital', 'hospitalName');

    if (!task) {
      res.status(404).json({ success: false, message: 'Task not found' });
      return;
    }

    res.status(200).json({ success: true, data: task });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Error fetching task', error: error.message });
  }
};

export const createTask = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const taskData = {
      ...req.body,
      user: req.user?._id
    };

    const newTask = new Task(taskData);
    await newTask.save();
    await newTask.populate('hospital', 'hospitalName');

    res.status(201).json({ success: true, data: newTask });
  } catch (error: any) {
    res.status(400).json({ success: false, message: 'Failed to create task', error: error.message });
  }
};

export const updateTask = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const updatedTask = await Task.findByIdAndUpdate(id, req.body, { new: true, runValidators: true }).populate('hospital', 'hospitalName');

    if (!updatedTask) {
      res.status(404).json({ success: false, message: 'Task not found' });
      return;
    }

    res.status(200).json({ success: true, data: updatedTask });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Failed to update task', error: error.message });
  }
};

export const deleteTask = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const task = await Task.findByIdAndDelete(id);

    if (!task) {
      res.status(404).json({ success: false, message: 'Task not found' });
      return;
    }

    res.status(200).json({ success: true, message: 'Task deleted successfully' });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Error deleting task', error: error.message });
  }
};
