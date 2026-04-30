import mongoose, { Document, Schema } from 'mongoose';

export interface IGraph extends Document {
  email: string;
  userId: string;
  accessToken: string;
  refreshToken: string;
  createdAt: Date;
  updatedAt: Date;
}

const GraphSchema = new Schema<IGraph>(
  {
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      trim: true,
      lowercase: true,
    },
    userId: {
      type: String,
      required: [true, 'User ID is required'],
    },
    accessToken: {
      type: String,
      required: [true, 'Access Token is required'],
    },
    refreshToken: {
      type: String,
      required: [true, 'Refresh Token is required'],
    },
  },
  {
    timestamps: true,
  }
);

export default mongoose.model<IGraph>('Graph', GraphSchema);
