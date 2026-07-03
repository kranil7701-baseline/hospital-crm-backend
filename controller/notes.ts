import type { Request, Response } from "express";
import type { AuthRequest } from "../middleware/authMiddleware.ts";
import Notes from "../model/Notes.ts";
import Hospital from "../model/Hospital.ts";
import mongoose from "mongoose";
import dotenv from "dotenv";
import { handleMentions } from "../helper/mentionNotification.ts";
import { UserRole } from "../model/User.ts";
dotenv.config();

export const getNotes = async (req: Request, res: Response): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const search = (req.query.search as string) || "";
    const userId = req.query.userId as string;
    const hospitalId = req.query.hospitalId as string;
    const productId = req.query.productId as string;

    const skip = (page - 1) * limit;
    const matchStage: any = {};

    if (userId) {
      matchStage.user = new mongoose.Types.ObjectId(userId);
    }

    if (hospitalId) {
      matchStage.hospital = new mongoose.Types.ObjectId(hospitalId);
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
          from: "products",
          localField: "products",
          foreignField: "_id",
          as: "products",
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

    const result = await Notes.aggregate(pipeline);
    const notesList = result[0]?.data || [];
    const total = result[0]?.totalCount[0]?.total || 0;

    res.status(200).json({
      success: true,
      page,
      limit,
      totalNotes: total,
      totalPages: Math.ceil(total / limit),
      data: notesList,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: "Failed to retrieve notes",
      error: error.message,
    });
  }
};

export const getNoteById = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { id } = req.params;
    const note = await Notes.findById(id)
      .populate("hospital", "hospitalName")
      .populate("products", "name");

    if (!note) {
      res.status(404).json({ success: false, message: "Note not found" });
      return;
    }

    res.status(200).json({ success: true, data: note });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: "Error fetching note",
      error: error.message,
    });
  }
};

export const createNote = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const noteText = req.body.notes || req.body.note || "";
    await handleMentions(req, noteText, "note", req.body.hospital);

    const noteData = {
      ...req.body,
      user: req.user?._id,
    };

    const newNote = new Notes(noteData);
    await newNote.save();
    await newNote.populate([
      { path: "hospital", select: "hospitalName" },
      { path: "products", select: "name" },
    ]);

    res.status(201).json({ success: true, data: newNote });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: "Failed to create note",
      error: error.message,
    });
  }
};

export const updateNote = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const { id } = req.params;

    const existingNote = await Notes.findById(id);
    if (!existingNote) {
      res.status(404).json({ success: false, message: "Note not found" });
      return;
    }

    const isPrivileged = req.user?.role === UserRole.ADMIN || req.user?.role === UserRole.CUSTOMER_SUCCESS;
    if (!isPrivileged) {
      const isCreator = existingNote.user?.toString() === req.user?._id?.toString();
      let isHospitalUser = false;
      if (existingNote.hospital) {
        const hospital = await Hospital.findById(existingNote.hospital);
        isHospitalUser = hospital?.user?.toString() === req.user?._id?.toString();
      }
      if (!isCreator && !isHospitalUser) {
        res.status(403).json({
          success: false,
          message: "You don't have permission to update this note",
        });
        return;
      }
    }

    const updatedNote = await Notes.findByIdAndUpdate(id, req.body, {
      new: true,
      runValidators: true,
    }).populate([
      { path: "hospital", select: "hospitalName" },
      { path: "products", select: "name" },
    ]);

    if (!updatedNote) {
      res.status(404).json({ success: false, message: "Note not found" });
      return;
    }

    const noteText = req.body.notes || req.body.note || "";
    await handleMentions(req, noteText, "note", updatedNote.hospital?._id?.toString() || req.body.hospital);

    res.status(200).json({ success: true, data: updatedNote });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: "Failed to update note",
      error: error.message,
    });
  }
};

export const deleteNote = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const { id } = req.params;

    const note = await Notes.findById(id);
    if (!note) {
      res.status(404).json({ success: false, message: "Note not found" });
      return;
    }

    const isPrivileged = req.user?.role === UserRole.ADMIN || req.user?.role === UserRole.CUSTOMER_SUCCESS;
    if (!isPrivileged) {
      const isCreator = note.user?.toString() === req.user?._id?.toString();
      let isHospitalUser = false;
      if (note.hospital) {
        const hospital = await Hospital.findById(note.hospital);
        isHospitalUser = hospital?.user?.toString() === req.user?._id?.toString();
      }
      if (!isCreator && !isHospitalUser) {
        res.status(403).json({
          success: false,
          message: "You don't have permission to delete this note",
        });
        return;
      }
    }

    await Notes.findByIdAndDelete(id);

    res
      .status(200)
      .json({ success: true, message: "Note deleted successfully" });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: "Error deleting note",
      error: error.message,
    });
  }
};
