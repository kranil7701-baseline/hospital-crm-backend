import mongoose, { Document, Schema } from "mongoose";

export interface IContact extends Document {
  firstName: string;
  lastName?: string;
  user: mongoose.Types.ObjectId;
  designation: string;
  hospitals: mongoose.Types.ObjectId[];
  product?: mongoose.Types.ObjectId[];
  phoneNumber: string;
  secondaryPhoneNumber?: string;
  email: string;
  isPrimary: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const ContactSchema: Schema = new Schema(
  {
    firstName: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    lastName: {
      type: String,
      trim: true,
      index: true,
    },
    designation: {
      type: String,
      // required: true,
      trim: true,
    },
    hospitals: [
      {
        type: Schema.Types.ObjectId,
        ref: "Hospital",
      },
    ],
    product: [
      {
        type: Schema.Types.ObjectId,
        ref: "Product",
      },
    ],
    phoneNumber: {
      type: String,
      trim: true,
    },
    secondaryPhoneNumber: {
      type: String,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      // required: true
    },
    isPrimary: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  },
);

export default mongoose.model<IContact>("Contact", ContactSchema);
