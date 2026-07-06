import mongoose, { Document, Schema } from "mongoose";

export interface IHospital extends Document {
  idn: mongoose.Types.ObjectId;
  primaryRep: mongoose.Types.ObjectId;
  secondaryRep: mongoose.Types.ObjectId;
  gpo: mongoose.Types.ObjectId;
  hospitalName: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  competitiveProduct: string;
  teamHospital: boolean;
  magnetHospital: boolean;
  notes: string;
  contacts: mongoose.Types.ObjectId[];
  documents: string[];
  ICUBeds: number;
  location: string;
  totalBeds: number;
  createdAt: Date;
  updatedAt: Date;
}

const HospitalSchema: Schema = new Schema(
  {
    idn: {
      type: Schema.Types.ObjectId,
      ref: "IDN",
      required: true,
    },
    gpo: {
      type: Schema.Types.ObjectId,
      ref: "GPO",
    },
    contacts: [
      {
        type: Schema.Types.ObjectId,
        ref: "Contact",
      },
    ],
    primaryRep: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    secondaryRep: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    hospitalName: {
      type: String,
      required: true,
      trim: true,
    },
    address: {
      type: String,
      trim: true,
    },
    city: {
      type: String,
      trim: true,
    },
    state: {
      type: String,
      trim: true,
    },
    zip: {
      type: String,
      trim: true,
    },
    competitiveProduct: {
      type: String,
      trim: true,
    },
    teamHospital: {
      type: Boolean,
    },
    magnetHospital: {
      type: Boolean,
    },
    documents: [
      {
        type: String,
        trim: true,
      },
    ],
    // bedsWithMac: {
    //   type: Number,
    // },
    ICUBeds: {
      type: Number,
    },
    totalBeds: {
      type: Number,
    },
    location: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: true,
  },
);

export default mongoose.model<IHospital>("Hospital", HospitalSchema);
