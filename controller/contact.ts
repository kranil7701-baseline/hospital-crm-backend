import type { Request, Response } from 'express';
import type { AuthRequest } from '../middleware/authMiddleware.ts';
import Contact from '../model/Contact.ts';
import mongoose from "mongoose";


export const getContacts = async (req: Request, res: Response): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const search = (req.query.search as string) || "";
    const userId = req.query.userId as string;

    const skip = (page - 1) * limit;
    const matchStage: any = {};

    if (userId) {
      matchStage.user = new mongoose.Types.ObjectId(userId);
    }

    if (search) {
      matchStage.$or = [
        { firstName: { $regex: search, $options: "i" } },
        { lastName: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
        { designation: { $regex: search, $options: "i" } },
        { "hospital.hospitalName": { $regex: search, $options: "i" } }
      ];
    }

    const pipeline: any[] = [
      {
        $lookup: {
          from: "hospitals",
          localField: "hospital",
          foreignField: "_id",
          as: "hospital"
        }
      },
      { $unwind: { path: "$hospital", preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: "idns",
          localField: "hospital.idn",
          foreignField: "_id",
          as: "hospital.idn"
        }
      },
      { $unwind: { path: "$hospital.idn", preserveNullAndEmptyArrays: true } },

      // 🔗 Join GPO (ONLY for populate, not search)
      {
        $lookup: {
          from: "gpos",
          localField: "hospital.gpo",
          foreignField: "_id",
          as: "hospital.gpo"
        }
      },
      { $unwind: { path: "$hospital.gpo", preserveNullAndEmptyArrays: true } },
      { $match: matchStage },
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

    const result = await Contact.aggregate(pipeline);
    const contacts = result[0]?.data || [];
    const total = result[0]?.totalCount[0]?.total || 0;

    res.status(200).json({
      success: true,
      page,
      limit,
      totalContacts: total,
      totalPages: Math.ceil(total / limit),
      data: contacts
    });

  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: "Failed to retrieve contacts",
      error: error.message
    });
  }
};

export const getContactById = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    if (typeof id !== 'string') {
      res.status(400).json({ success: false, message: 'Invalid ID' });
      return;
    }

    const contact = await Contact.findById(id).populate('hospital');

    if (!contact) {
      res.status(404).json({
        success: false,
        message: 'Contact not found'
      });
      return;
    }

    res.status(200).json({
      success: true,
      data: contact
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: 'Error fetching contact',
      error: error.message
    });
  }
};

export const createContact = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { email, phoneNumber } = req.body;

    // Check if contact with same email or phone number already exists
    const existingContact = await Contact.findOne({
      $or: [{ email }, { phoneNumber }]
    });

    if (existingContact) {
      res.status(400).json({
        success: false,
        message: existingContact.email === email
          ? 'Contact with this email already exists'
          : 'Contact with this phone number already exists'
      });
      return;
    }

    // Associate contact with the authenticated user
    const contactData = {
      ...req.body,
      user: req.user?._id
    };

    const newContact = new Contact(contactData);
    await newContact.save();

    await newContact.populate({
      path: 'hospital',
      populate: [
        { path: 'idn' },
        { path: 'gpo' }
      ]
    });

    res.status(201).json({
      success: true,
      data: newContact
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: 'Failed to create contact',
      error: error.message
    });
  }
};

export const deleteContact = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    if (typeof id !== 'string') {
      res.status(400).json({ success: false, message: 'Invalid ID' });
      return;
    }

    const contact = await Contact.findByIdAndDelete(id);

    if (!contact) {
      res.status(404).json({ success: false, message: 'Contact not found' });
      return;
    }

    res.status(200).json({ success: true, message: 'Contact deleted successfully' });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Error deleting contact', error: error.message });
  }
};

export const updateContact = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    if (typeof id !== 'string') {
      res.status(400).json({ success: false, message: 'Invalid ID' });
      return;
    }

    const updatedContact = await Contact.findByIdAndUpdate(
      id,
      req.body,
      { new: true, runValidators: true }
    );

    if (!updatedContact) {
      res.status(404).json({ success: false, message: 'Contact not found' });
      return;
    }

    res.status(200).json({
      success: true,
      data: updatedContact
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: 'Failed to update contact',
      error: error.message
    });
  }
};
