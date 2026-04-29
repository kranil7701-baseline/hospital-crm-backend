import mongoose, { Document, Schema } from "mongoose";

export enum DocumentCategory {
    CONTRACT = "Contract",
    REPORT = "Report",
    QUOTE = "Quote",
    PRESENTATION = "Presentation",
    OTHER = "Other",
}

export interface IDocument extends Document {
    name: string;
    category: DocumentCategory;
    fileUrl: string;
    filename: string;
    hospital: mongoose.Types.ObjectId;
    user: mongoose.Types.ObjectId;
    fileSize: number;
    fileType: string;
    createdAt: Date;
    updatedAt: Date;
}

const DocumentSchema: Schema = new Schema(
    {
        name: {
            type: String,
            required: true,
            trim: true,
        },
        category: {
            type: String,
            enum: Object.values(DocumentCategory),
            default: DocumentCategory.OTHER,
            required: true,
        },
        fileUrl: {
            type: String,
            required: true,
        },
        filename: {
            type: String,
            required: true,
        },
        hospital: {
            type: Schema.Types.ObjectId,
            ref: "Hospital",
            required: true,
        },
        user: {
            type: Schema.Types.ObjectId,
            ref: "User",
            required: true,
        },
        fileSize: {
            type: Number,
        },
        fileType: {
            type: String,
        },
    },
    {
        timestamps: true,
    },
);

DocumentSchema.index({ hospital: 1, category: 1 });

export default mongoose.model<IDocument>("Document", DocumentSchema);
