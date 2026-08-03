import mongoose, { Document, Schema } from "mongoose";

export interface IIDNNote {
  _id?: mongoose.Types.ObjectId;
  content: string;
  user: mongoose.Types.ObjectId;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface IIDN extends Document {
  name: string;
  hospitals: mongoose.Types.ObjectId[];
  user: mongoose.Types.ObjectId;
  expectedARR: number;
  notes: IIDNNote[];
  createdAt: Date;
  updatedAt: Date;
}

const IDNSchema: Schema = new Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    hospitals: [
      {
        type: Schema.Types.ObjectId,
        ref: "Hospital",
      },
    ],
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    notes: [
      {
        content: {
          type: String,
          required: true,
          trim: true,
        },
        user: {
          type: Schema.Types.ObjectId,
          ref: "User",
          required: true,
        },
        createdAt: {
          type: Date,
          default: Date.now,
        },
        updatedAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
  },
  {
    timestamps: true,
  },
);

export default mongoose.model<IIDN>("IDN", IDNSchema);
