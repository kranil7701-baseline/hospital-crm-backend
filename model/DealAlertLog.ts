import mongoose, { Document, Schema } from "mongoose";

export interface IDealAlertLog extends Document {
  dealId: mongoose.Types.ObjectId;
  productInstanceId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  milestone: "10_DAY" | "5_DAY";
  sentAt: Date;
}

const DealAlertLogSchema: Schema = new Schema(
  {
    dealId: {
      type: Schema.Types.ObjectId,
      ref: "Deal",
      required: true,
      index: true,
    },
    productInstanceId: {
      type: Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    milestone: {
      type: String,
      enum: ["10_DAY", "5_DAY"],
      required: true,
    },
    sentAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  },
);

DealAlertLogSchema.index(
  { dealId: 1, productInstanceId: 1, milestone: 1 },
  { unique: true },
);

export default mongoose.model<IDealAlertLog>(
  "DealAlertLog",
  DealAlertLogSchema,
);
