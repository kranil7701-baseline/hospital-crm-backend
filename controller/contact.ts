import type { Request, Response } from "express";
import type { AuthRequest } from "../middleware/authMiddleware.ts";
import Contact from "../model/Contact.ts";
import mongoose from "mongoose";

export const getContacts = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const search = (req.query.search as string) || "";
    const userId = req.query.userId as string;
    const productId = req.query.productId as string;

    const skip = (page - 1) * limit;

    const filter: any = {};

    if (userId && mongoose.Types.ObjectId.isValid(userId)) {
      filter.user = userId;
    }

    // product is array
    if (productId && mongoose.Types.ObjectId.isValid(productId)) {
      filter.product = productId;
    }

    if (search) {
      filter.$or = [
        { firstName: { $regex: search, $options: "i" } },
        { lastName: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
        { designation: { $regex: search, $options: "i" } },
        { phoneNumber: { $regex: search, $options: "i" } },
      ];
    }

    const contacts = await Contact.find(filter)
      .select("-createdAt -updatedAt -__v -isPrimary")
      .populate({
        path: "hospital",
        select: "hospitalName gpo idn",
        populate: [
          {
            path: "gpo",
            select: "name -_id",
          },
          {
            path: "idn",
            select: "name -_id",
          },
        ],
      })
      .populate({
        path: "product",
        select: "name -_id",
      })
      .sort({
        firstName: 1,
        lastName: 1,
      })
      .skip(skip)
      .limit(limit)
      .lean();

    const total = await Contact.countDocuments(filter);

    res.status(200).json({
      success: true,
      page,
      limit,
      totalContacts: total,
      totalPages: Math.ceil(total / limit),
      hasMore: total > skip + contacts.length,
      data: contacts,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: "Failed to retrieve contacts",
      error: error.message,
    });
  }
};

export const ContactsTesting = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const contacts = await Contact.aggregate([
      {
        $project: {
          _id: 0,
          contactid: "$_id",
          hospitalid: "$hospital",
        },
      },
    ]);

    res.status(200).json({
      success: true,
      count: contacts.length,
      data: contacts,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const getContactById = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { id } = req.params;
    if (typeof id !== "string") {
      res.status(400).json({ success: false, message: "Invalid ID" });
      return;
    }

    const contact = await Contact.findById(id).populate("hospital");

    if (!contact) {
      res.status(404).json({
        success: false,
        message: "Contact not found",
      });
      return;
    }

    res.status(200).json({
      success: true,
      data: contact,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: "Error fetching contact",
      error: error.message,
    });
  }
};

export const createContact = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const { email, phoneNumber } = req.body;

    // Check if contact with same email or phone number already exists
    const existingContact = await Contact.findOne({
      $or: [{ email }, { phoneNumber }],
    });

    if (existingContact) {
      res.status(400).json({
        success: false,
        message:
          existingContact.email === email
            ? "Contact with this email already exists"
            : "Contact with this phone number already exists",
      });
      return;
    }

    // Associate contact with the authenticated user
    const contactData = {
      ...req.body,
      user: req.user?._id,
    };

    const newContact = new Contact(contactData);
    await newContact.save();

    await newContact.populate({
      path: "hospital",
      populate: [{ path: "idn" }, { path: "gpo" }],
    });

    res.status(201).json({
      success: true,
      data: newContact,
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: "Failed to create contact",
      error: error.message,
    });
  }
};

export const deleteContact = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { id } = req.params;
    if (typeof id !== "string") {
      res.status(400).json({ success: false, message: "Invalid ID" });
      return;
    }

    const contact = await Contact.findByIdAndDelete(id);

    if (!contact) {
      res.status(404).json({ success: false, message: "Contact not found" });
      return;
    }

    res
      .status(200)
      .json({ success: true, message: "Contact deleted successfully" });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: "Error deleting contact",
      error: error.message,
    });
  }
};

export const updateContact = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { id } = req.params;
    if (typeof id !== "string") {
      res.status(400).json({ success: false, message: "Invalid ID" });
      return;
    }

    const updatedContact = await Contact.findByIdAndUpdate(id, req.body, {
      new: true,
      runValidators: true,
    });

    if (!updatedContact) {
      res.status(404).json({ success: false, message: "Contact not found" });
      return;
    }

    res.status(200).json({
      success: true,
      data: updatedContact,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: "Failed to update contact",
      error: error.message,
    });
  }
};
