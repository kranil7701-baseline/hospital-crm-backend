import mongoose, { Document, Schema } from "mongoose";

export interface ITaskAlertLog extends Document {
  taskId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  milestone: "6_DAY" | "3_DAY" | "CUSTOM";
  createdAt: Date;
  updatedAt: Date;
}

const TaskAlertLogSchema: Schema = new Schema(
  {
    taskId: {
      type: Schema.Types.ObjectId,
      ref: "Task",
      required: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    milestone: {
      type: String,
      enum: ["6_DAY", "3_DAY", "CUSTOM"],
      required: true,
    },
  },
  {
    timestamps: true,
  },
);

TaskAlertLogSchema.index({ taskId: 1, milestone: 1 }, { unique: true });

export default mongoose.model<ITaskAlertLog>(
  "TaskAlertLog",
  TaskAlertLogSchema,
);
