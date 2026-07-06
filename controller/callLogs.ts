import type { Request, Response } from "express";
import type { AuthRequest } from "../middleware/authMiddleware.ts";
import CallLogs from "../model/CallLogs.ts";
import Hospital from "../model/Hospital.ts";
import mongoose from "mongoose";
import { UserRole } from "../model/User.ts";

export const getCallLogs = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const search = (req.query.search as string) || "";
    const userId = req.query.userId as string;
    const hospitalId = req.query.hospitalId as string;
    const contactId = req.query.contactId as string;
    const productId = req.query.productId as string;

    const skip = (page - 1) * limit;
    const matchStage: any = {};

    if (userId) {
      matchStage.user = new mongoose.Types.ObjectId(userId);
    }

    if (hospitalId) {
      matchStage.hospital = new mongoose.Types.ObjectId(hospitalId);
    }

    if (contactId) {
      matchStage.contact = new mongoose.Types.ObjectId(contactId);
    }

    if (productId && mongoose.Types.ObjectId.isValid(productId)) {
      matchStage.products = new mongoose.Types.ObjectId(productId);
    }

    if (search) {
      matchStage.notes = { $regex: search, $options: "i" };
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
          from: "contacts",
          localField: "contact",
          foreignField: "_id",
          as: "contact",
        },
      },
      { $unwind: { path: "$contact", preserveNullAndEmptyArrays: true } },

      {
        $lookup: {
          from: "products",
          localField: "products",
          foreignField: "_id",
          as: "products",
        },
      },

      { $sort: { Date: -1 } },
      {
        $facet: {
          data: [{ $skip: skip }, { $limit: limit }],
          totalCount: [{ $count: "total" }],
        },
      },
    ];

    const result = await CallLogs.aggregate(pipeline);
    const callLogs = result[0]?.data || [];
    const total = result[0]?.totalCount[0]?.total || 0;

    res.status(200).json({
      success: true,
      page,
      limit,
      totalCallLogs: total,
      totalPages: Math.ceil(total / limit),
      data: callLogs,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: "Failed to retrieve call logs",
      error: error.message,
    });
  }
};

export const getCallLogById = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { id } = req.params;
    const callLog = await CallLogs.findById(id)
      .populate("hospital", "hospitalName")
      .populate("contact")
      .populate("products", "name");

    if (!callLog) {
      res.status(404).json({ success: false, message: "Call log not found" });
      return;
    }

    res.status(200).json({ success: true, data: callLog });
  } catch (error: any) {
    res
      .status(500)
      .json({
        success: false,
        message: "Error fetching call log",
        error: error.message,
      });
  }
};

export const createCallLog = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const callLogData = {
      ...req.body,
      user: req.user?._id,
    };

    const newCallLog = new CallLogs(callLogData);
    await newCallLog.save();
    await newCallLog.populate([
      { path: "hospital", select: "hospitalName" },
      { path: "contact", select: "firstName" },
      { path: "products", select: "name" },
    ]);

    res.status(201).json({ success: true, data: newCallLog });
  } catch (error: any) {
    res
      .status(400)
      .json({
        success: false,
        message: "Failed to create call log",
        error: error.message,
      });
  }
};

export const updateCallLog = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const { id } = req.params;

    const existingCallLog = await CallLogs.findById(id);
    if (!existingCallLog) {
      res.status(404).json({ success: false, message: "Call log not found" });
      return;
    }

    const isPrivileged = req.user?.role === UserRole.ADMIN || req.user?.role === UserRole.CUSTOMER_SUCCESS;
    if (!isPrivileged) {
      const isCreator = existingCallLog.user?.toString() === req.user?._id?.toString();
      let isHospitalUser = false;
      if (existingCallLog.hospital) {
        const hospital = await Hospital.findById(existingCallLog.hospital);
        isHospitalUser = hospital?.primaryRep?.toString() === req.user?._id?.toString() || hospital?.secondaryRep?.toString() === req.user?._id?.toString();
      }
      if (!isCreator && !isHospitalUser) {
        res.status(403).json({
          success: false,
          message: "You don't have permission to update this call log",
        });
        return;
      }
    }

    const updatedCallLog = await CallLogs.findByIdAndUpdate(id, req.body, {
      new: true,
      runValidators: true,
    }).populate([
      { path: "hospital", select: "hospitalName" },
      { path: "contact", select: "firstName" },
      { path: "products", select: "name" },
    ]);

    if (!updatedCallLog) {
      res.status(404).json({ success: false, message: "Call log not found" });
      return;
    }

    res.status(200).json({ success: true, data: updatedCallLog });
  } catch (error: any) {
    res
      .status(500)
      .json({
        success: false,
        message: "Failed to update call log",
        error: error.message,
      });
  }
};

export const deleteCallLog = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const { id } = req.params;

    const callLog = await CallLogs.findById(id);
    if (!callLog) {
      res.status(404).json({ success: false, message: "Call log not found" });
      return;
    }

    const isPrivileged = req.user?.role === UserRole.ADMIN || req.user?.role === UserRole.CUSTOMER_SUCCESS;
    if (!isPrivileged) {
      const isCreator = callLog.user?.toString() === req.user?._id?.toString();
      let isHospitalUser = false;
      if (callLog.hospital) {
        const hospital = await Hospital.findById(callLog.hospital);
        isHospitalUser = hospital?.primaryRep?.toString() === req.user?._id?.toString() || hospital?.secondaryRep?.toString() === req.user?._id?.toString();
      }
      if (!isCreator && !isHospitalUser) {
        res.status(403).json({
          success: false,
          message: "You don't have permission to delete this call log",
        });
        return;
      }
    }

    await CallLogs.findByIdAndDelete(id);

    res
      .status(200)
      .json({ success: true, message: "Call log deleted successfully" });
  } catch (error: any) {
    res
      .status(500)
      .json({
        success: false,
        message: "Error deleting call log",
        error: error.message,
      });
  }
};
