import type { Request, Response } from "express";
import fs from "fs";
import path from "path";
import DocumentModel from "../model/Document.ts";

export const uploadAndCreateDocument = async (
    req: Request,
    res: Response,
): Promise<void> => {
    try {
        if (!req.file) {
            res.status(400).json({ success: false, message: "No file uploaded" });
            return;
        }

        const { name, category, hospitalId } = req.body;

        if (!name || !hospitalId) {
            fs.unlinkSync(req.file.path);
            res.status(400).json({
                success: false,
                message: "Name and Hospital ID are required",
            });
            return;
        }

        const fileUrl = `/uploads/${req.file.filename}`;

        const newDocument = await DocumentModel.create({
            name,
            category: category || "Other",
            fileUrl,
            filename: req.file.filename,
            hospital: hospitalId,
            user: (req as any).user._id,
            fileSize: req.file.size,
            fileType: req.file.mimetype,
        });

        res.status(201).json({
            success: true,
            message: "Document uploaded and saved successfully",
            data: newDocument,
        });
    } catch (error: any) {
        if (req.file) {
            fs.unlinkSync(req.file.path);
        }
        res.status(500).json({
            success: false,
            message: "Failed to upload and save document",
            error: error.message,
        });
    }
};

export const getHospitalDocuments = async (
    req: Request,
    res: Response,
): Promise<void> => {
    try {
        const { hospitalId } = req.params;

        if (!hospitalId) {
            res
                .status(400)
                .json({ success: false, message: "Hospital ID is required" });
            return;
        }

        const documents = await DocumentModel.find({ hospital: hospitalId })
            .sort({ createdAt: -1 })
            .populate("user", "name email");

        res.status(200).json({
            success: true,
            data: documents,
        });
    } catch (error: any) {
        res.status(500).json({
            success: false,
            message: "Failed to fetch documents",
            error: error.message,
        });
    }
};

export const deleteDocument = async (
    req: Request,
    res: Response,
): Promise<void> => {
    try {
        const { id } = req.params;

        const document = await DocumentModel.findById(id);

        if (!document) {
            res.status(404).json({ success: false, message: "Document not found" });
            return;
        }

        const filePath = path.join("uploads", document.filename);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }

        await DocumentModel.findByIdAndDelete(id);

        res.status(200).json({
            success: true,
            message: "Document deleted successfully",
        });
    } catch (error: any) {
        res.status(500).json({
            success: false,
            message: "Failed to delete document",
            error: error.message,
        });
    }
};
