import type { Request, Response } from "express";
import type { AuthRequest } from "../middleware/authMiddleware.ts";
import Contact from "../model/Contact.ts";
import Hospital from "../model/Hospital.ts";
import mongoose from "mongoose";
import { UserRole } from "../model/User.ts";
import { buildFieldWordSearchCondition } from "../helper/searchHelper.ts";

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
      matchStage.hospitals = new mongoose.Types.ObjectId(hospitalId);
    }

    if (search.trim()) {
      matchStage.$or = [
        buildFieldWordSearchCondition("firstName", search),
        buildFieldWordSearchCondition("lastName", search),
        buildFieldWordSearchCondition("fullName", search),
        buildFieldWordSearchCondition("email", search),
        buildFieldWordSearchCondition("phoneNumber", search),
        buildFieldWordSearchCondition("hospitalDetails.hospitalName", search),
      ].filter(Boolean);
    }

    const matchedContacts = await Contact.aggregate([
      {
        $lookup: {
          from: "hospitals",
          localField: "hospitals",
          foreignField: "_id",
          as: "hospitalDetails",
        },
      },
      {
        $addFields: {
          fullName: {
            $concat: [
              { $ifNull: ["$firstName", ""] },
              " ",
              { $ifNull: ["$lastName", ""] },
            ],
          },
        },
      },
      {
        $match: matchStage,
      },
      {
        $group: {
          _id: "$_id",
          firstName: { $first: "$firstName" },
          lastName: { $first: "$lastName" },
        },
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
        path: "hospitals",
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
        "hospitals",
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
    const { email, hospitals } = req.body;

    if (!hospitals || !Array.isArray(hospitals) || hospitals.length === 0) {
      res.status(400).json({ success: false, message: "Hospitals list is required" });
      return;
    }

    // Check if the contact email already exists globally
    let contact = await Contact.findOne({ email });

    if (contact) {
      // Add any new hospitals to their hospitals list
      const existingHospitals = contact.hospitals.map((h: any) => h.toString());
      const newHospitals = hospitals.filter((h: string) => !existingHospitals.includes(h));

      if (newHospitals.length === 0) {
        res.status(400).json({
          success: false,
          message: "This contact is already associated with all selected hospitals",
        });
        return;
      }

      contact.hospitals.push(...newHospitals.map((id: string) => new mongoose.Types.ObjectId(id)));
      
      // Update other fields if provided in req.body
      if (req.body.firstName) contact.firstName = req.body.firstName;
      if (req.body.lastName) contact.lastName = req.body.lastName;
      if (req.body.designation) contact.designation = req.body.designation;
      if (req.body.phoneNumber) contact.phoneNumber = req.body.phoneNumber;
      if (req.body.secondaryPhoneNumber) contact.secondaryPhoneNumber = req.body.secondaryPhoneNumber;
      if (req.body.product) contact.product = req.body.product;

      await contact.save();
    } else {
      // Create new contact
      const contactData = {
        ...req.body,
        user: req.user?._id,
      };
      contact = new Contact(contactData);
      await contact.save();
    }

    if (req.body.isPrimary && hospitals && Array.isArray(hospitals) && hospitals.length > 0) {
      await Hospital.updateMany(
        { _id: { $in: hospitals } },
        { $addToSet: { primaryContacts: contact._id } }
      );
    }

    await contact.populate({
      path: "hospitals",
      populate: [{ path: "idn" }, { path: "gpo" }],
    });

    res.status(201).json({
      success: true,
      data: contact,
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
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const { id } = req.params;
    if (typeof id !== "string") {
      res.status(400).json({ success: false, message: "Invalid ID" });
      return;
    }

    const contact = await Contact.findById(id);
    if (!contact) {
      res.status(404).json({ success: false, message: "Contact not found" });
      return;
    }

    const isPrivileged = req.user?.role === UserRole.ADMIN || req.user?.role === UserRole.CUSTOMER_SUCCESS;
    if (!isPrivileged) {
      const isCreator = contact.user?.toString() === req.user?._id?.toString();
      let isHospitalUser = false;
      if (contact.hospitals && contact.hospitals.length > 0) {
        const hospitals = await Hospital.find({ _id: { $in: contact.hospitals } });
        isHospitalUser = hospitals.some(
          (hospital) =>
            hospital?.primaryRep?.toString() === req.user?._id?.toString() ||
            hospital?.secondaryRep?.toString() === req.user?._id?.toString()
        );
      }
      if (!isCreator && !isHospitalUser) {
        res.status(403).json({
          success: false,
          message: "You don't have permission to delete this contact",
        });
        return;
      }
    }

    const hospitalId = req.query.hospitalId as string;

    if (hospitalId && mongoose.Types.ObjectId.isValid(hospitalId)) {
      // Remove hospital ID from contact's hospitals array
      contact.hospitals = contact.hospitals.filter(
        (h) => h.toString() !== hospitalId
      );

      if (contact.hospitals.length === 0) {
        await Contact.findByIdAndDelete(id);
        res.status(200).json({
          success: true,
          message: "Contact deleted successfully as they have no remaining hospital associations",
        });
      } else {
        await contact.save();
        res.status(200).json({
          success: true,
          message: "Contact dissociated from this hospital successfully",
        });
      }
    } else {
      // Delete globally
      await Contact.findByIdAndDelete(id);
      res.status(200).json({
        success: true,
        message: "Contact deleted successfully",
      });
    }
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: "Error deleting contact",
      error: error.message,
    });
  }
};

export const updateContact = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const { id } = req.params;
    if (typeof id !== "string") {
      res.status(400).json({ success: false, message: "Invalid ID" });
      return;
    }

    const existingContact = await Contact.findById(id);
    if (!existingContact) {
      res.status(404).json({ success: false, message: "Contact not found" });
      return;
    }

    const isPrivileged = req.user?.role === UserRole.ADMIN || req.user?.role === UserRole.CUSTOMER_SUCCESS;
    if (!isPrivileged) {
      const isCreator = existingContact.user?.toString() === req.user?._id?.toString();
      let isHospitalUser = false;
      if (existingContact.hospitals && existingContact.hospitals.length > 0) {
        const hospitals = await Hospital.find({ _id: { $in: existingContact.hospitals } });
        isHospitalUser = hospitals.some(
          (hospital) =>
            hospital?.primaryRep?.toString() === req.user?._id?.toString() ||
            hospital?.secondaryRep?.toString() === req.user?._id?.toString()
        );
      }
      if (!isCreator && !isHospitalUser) {
        res.status(403).json({
          success: false,
          message: "You don't have permission to update this contact",
        });
        return;
      }
    }

    const updateData = { ...req.body };
    if (!updateData.hospitals || !Array.isArray(updateData.hospitals) || updateData.hospitals.length === 0) {
      delete updateData.hospitals;
    }

    const updatedContact = await Contact.findByIdAndUpdate(id, updateData, {
      new: true,
      runValidators: true,
    }).populate({
      path: "hospitals",
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

    if (updatedContact) {
      const { currentHospitalId, isPrimary } = req.body;
      if (typeof isPrimary === "boolean") {
        if (currentHospitalId && mongoose.Types.ObjectId.isValid(currentHospitalId)) {
          if (isPrimary) {
            await Hospital.findByIdAndUpdate(currentHospitalId, {
              $addToSet: { primaryContacts: updatedContact._id },
            });
          } else {
            await Hospital.findByIdAndUpdate(currentHospitalId, {
              $pull: { primaryContacts: updatedContact._id },
            });
          }
        } else {
          const targetHospitals = updatedContact.hospitals.map((h: any) =>
            typeof h === "object" ? h._id : h
          );
          if (isPrimary) {
            await Hospital.updateMany(
              { _id: { $in: targetHospitals } },
              { $addToSet: { primaryContacts: updatedContact._id } }
            );
          } else {
            await Hospital.updateMany(
              { _id: { $in: targetHospitals } },
              { $pull: { primaryContacts: updatedContact._id } }
            );
          }
        }
      }
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
