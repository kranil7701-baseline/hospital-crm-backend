import type { Request, Response } from "express";
import type { AuthRequest } from "../middleware/authMiddleware.ts";
import Contact from "../model/Contact.ts";
import mongoose from "mongoose";
import { UserRole } from "../model/User.ts";

export const getContacts = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const search = (req.query.search as string) || "";
    const userId = req.query.userId as string;
    const productId = req.query.productId as string;
    const hospitalId = req.query.hospitalId as string;

    const skip = (page - 1) * limit;

    const filter: any = {};

    // Only admins, executives, and customer success can view all contacts
    const currentUser = req.user;
    const isAdminOrExecutive =
      currentUser &&
      (currentUser.role === UserRole.ADMIN ||
        currentUser.role === UserRole.EXECUTIVE ||
        currentUser.role === UserRole.CUSTOMER_SUCCESS);

    const matchStage: any = {};

    if (isAdminOrExecutive) {
      if (userId && mongoose.Types.ObjectId.isValid(userId)) {
        matchStage.user = new mongoose.Types.ObjectId(userId);
      }
    } else {
      // Non-privileged users can only see their own contacts
      if (!currentUser || !currentUser._id) {
        res.status(401).json({ success: false, message: "Unauthorized" });
        return;
      }
      matchStage.user = new mongoose.Types.ObjectId(String(currentUser._id));
    }

    // product filter is still supported
    if (productId && mongoose.Types.ObjectId.isValid(productId)) {
      matchStage.product = new mongoose.Types.ObjectId(productId);
    }

    if (hospitalId && mongoose.Types.ObjectId.isValid(hospitalId)) {
      matchStage.hospital = new mongoose.Types.ObjectId(hospitalId);
    }

    if (search) {
      matchStage.$or = [
        { firstName: { $regex: search, $options: "i" } },
        { lastName: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
        { designation: { $regex: search, $options: "i" } },
        { phoneNumber: { $regex: search, $options: "i" } },
        { "hospitalDetails.hospitalName": { $regex: search, $options: "i" } },
      ];
    }

    const matchedContacts = await Contact.aggregate([
      {
        $lookup: {
          from: "hospitals",
          localField: "hospital",
          foreignField: "_id",
          as: "hospitalDetails",
        },
      },
      {
        $unwind: {
          path: "$hospitalDetails",
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $match: matchStage,
      },
      {
        $sort: {
          firstName: 1,
          lastName: 1,
        },
      },
      {
        $project: {
          _id: 1,
        },
      },
    ]);

    const matchedIds = matchedContacts.map((c) => c._id);
    const total = matchedIds.length;
    const paginatedIds = matchedIds.slice(skip, skip + limit);

    const contacts = await Contact.find({ _id: { $in: paginatedIds } })
      .select("-createdAt -updatedAt -__v -isPrimary")
      .populate("product", "name")
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
      .sort({
        firstName: 1,
        lastName: 1,
      })
      .lean();

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

    const contact = await Contact.findById(id)
      .populate(
        "hospital",
        "hospitalName gpo idn city state zip idn gpo teamHospital magnetHospital _id address location",
      )
      .populate("product", "name _id")
      .select("-createdAt -updatedAt -__v");

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
    const { email, hospital } = req.body;

    const existingContact = await Contact.findOne({ email, hospital });

    if (existingContact) {
      res.status(400).json({
        success: false,
        message: "This contact is already associated with this hospital",
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
    }).populate({
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
    }).populate("product", "name");

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
