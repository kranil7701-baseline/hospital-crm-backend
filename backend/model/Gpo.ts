import mongoose, { Document, Schema } from 'mongoose';

export interface GPO extends Document {
  name: string;
  hospitals: mongoose.Types.ObjectId[];
  expectedARR: number;
  user: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const GPOSchema: Schema = new Schema({
  name: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  hospitals: [{
    type: Schema.Types.ObjectId,
    ref: 'Hospital'
  }],
  user: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  // expectedARR: {
  //   type: Number,
  //   required: true,
  //   min: 0
  // }
}, {
  timestamps: true
});


export default mongoose.model<GPO>('GPO', GPOSchema);
