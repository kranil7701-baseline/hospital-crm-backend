import mongoose, { Document, Schema } from 'mongoose';

export interface IHospital extends Document {
  idn: mongoose.Types.ObjectId;
  hospitalName: string;
  address: string;
  user: mongoose.Types.ObjectId;
  city: string;
  state: string;
  zip: string;
  gpo: mongoose.Types.ObjectId,
  competitiveProduct: string;
  teamHospital: boolean;
  magnetHospital: boolean;
  products: string[];
  notes: string;
  contacts: mongoose.Types.ObjectId[];
  documents: string[];
  bedsWithMac: number;
  ICUBeds: number;
  location: string;
  createdAt: Date;
  updatedAt: Date;
}

const HospitalSchema: Schema = new Schema({
  idn: {
    type: Schema.Types.ObjectId,
    ref: 'IDN',
    required: true
  },
  gpo: {
    type: Schema.Types.ObjectId,
    ref: 'GPO',
    required: true
  },
  contacts: [{
    type: Schema.Types.ObjectId,
    ref: 'Contact'
  }],
  user: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  hospitalName: {
    type: String,
    required: true,
    trim: true
  },
  address: {
    type: String,
    required: true,
    trim: true
  },
  city: {
    type: String,
    required: true,
    trim: true
  },
  state: {
    type: String,
    required: true,
    trim: true
  },
  zip: {
    type: String,
    required: true,
    trim: true
  },
  competitiveProduct: {
    type: String,
    trim: true
  },
  teamHospital: {
    type: Boolean,
    required: true
  },
  magnetHospital: {
    type: Boolean,
    required: true
  },
  documents: [{
    type: String,
    trim: true
  }],
  bedsWithMac: {
    type: Number,
  },
  ICUBeds: {
    type: Number,
  },
  location: {
    type: String,
    trim: true
  }
}, {
  timestamps: true
});


export default mongoose.model<IHospital>('Hospital', HospitalSchema);