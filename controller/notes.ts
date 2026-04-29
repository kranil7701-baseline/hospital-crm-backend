import type { Request, Response } from 'express';
import type { AuthRequest } from '../middleware/authMiddleware.ts';
import Notes from '../model/Notes.ts';
import mongoose from "mongoose";

export const getNotes = async (req: Request, res: Response): Promise<void> => {
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
      matchStage.notes = { $regex: search, $options: "i" };
    }

    const pipeline: any[] = [
      { $match: matchStage },
      // ✅ Optimized lookup for hospital
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
      { $sort: { createdAt: -1 } },
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

    const result = await Notes.aggregate(pipeline);
    const notesList = result[0]?.data || [];
    const total = result[0]?.totalCount[0]?.total || 0;

    res.status(200).json({
      success: true,
      page,
      limit,
      totalNotes: total,
      totalPages: Math.ceil(total / limit),
      data: notesList
    });

  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: "Failed to retrieve notes",
      error: error.message
    });
  }
};

export const getNoteById = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const note = await Notes.findById(id).populate('hospital', 'hospitalName');

    if (!note) {
      res.status(404).json({ success: false, message: 'Note not found' });
      return;
    }

    res.status(200).json({ success: true, data: note });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Error fetching note', error: error.message });
  }
};

export const createNote = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const noteData = {
      ...req.body,
      user: req.user?._id
    };

    const newNote = new Notes(noteData);
    await newNote.save();
    await newNote.populate('hospital', 'hospitalName');

    res.status(201).json({ success: true, data: newNote });
  } catch (error: any) {
    res.status(400).json({ success: false, message: 'Failed to create note', error: error.message });
  }
};

export const updateNote = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const updatedNote = await Notes.findByIdAndUpdate(id, req.body, { new: true, runValidators: true }).populate('hospital', 'hospitalName');

    if (!updatedNote) {
      res.status(404).json({ success: false, message: 'Note not found' });
      return;
    }

    res.status(200).json({ success: true, data: updatedNote });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Failed to update note', error: error.message });
  }
};

export const deleteNote = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const note = await Notes.findByIdAndDelete(id);

    if (!note) {
      res.status(404).json({ success: false, message: 'Note not found' });
      return;
    }

    res.status(200).json({ success: true, message: 'Note deleted successfully' });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Error deleting note', error: error.message });
  }
};
