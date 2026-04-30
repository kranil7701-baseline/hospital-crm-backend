import mongoose, { Document, Schema } from 'mongoose';

export interface IPipeline extends Document {
  name: string;
  order: number;
  expectedARR: number;
  createdAt: Date;
  updatedAt: Date;
}

const PipelineSchema: Schema = new Schema({
  name: {
    type: String,
    required: true,
    unique: true,
    enum: ['Demo', 'CPA', 'Committee', 'Trial', 'Pending Decision', 'Closed Won', 'Implemented'],
    trim: true
  },
  order: {
    type: Number,
    required: true,
    unique: true,
    min: 1,
    max: 7
  },
  expectedARR: {
    type: Number,
    required: true,
    min: 0
  }
}, {
  timestamps: true
});

export default mongoose.model<IPipeline>('Pipeline', PipelineSchema);