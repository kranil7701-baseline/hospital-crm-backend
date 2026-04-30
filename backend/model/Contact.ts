import mongoose, { Document, Schema } from 'mongoose';

export interface IContact extends Document {
  firstName: string;
  lastName: string;
  user: mongoose.Types.ObjectId;
  designation: string;
  hospital: mongoose.Types.ObjectId;
  phoneNumber: string;
  email: string;
  isPrimary: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const ContactSchema: Schema = new Schema({
  firstName: {
    type: String,
    required: true,
    trim: true,
    index: true
  },
  lastName: {
    type: String,
    required: true,
    trim: true,
    index: true
  },
  designation: {
    type: String,
    required: true,
    trim: true
  },
  hospital: {
    type: Schema.Types.ObjectId,
    ref: 'Hospital',
    required: true
  },
  phoneNumber: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true,
    match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please enter a valid email']
  },
  user: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  isPrimary: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});


export default mongoose.model<IContact>('Contact', ContactSchema);