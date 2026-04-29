import mongoose, { Document, Schema } from 'mongoose';

export interface ICallLogs extends Document {
    Date: Date;
    contact: mongoose.Types.ObjectId;
    notes: string;
    hospital: mongoose.Types.ObjectId;
    user: mongoose.Types.ObjectId;
    createdAt: Date;
    updatedAt: Date;
}

const CallLogsSchema: Schema = new Schema({
    Date: {
        type: Date,
        required: true,
        trim: true,
    },
    contact: {
        type: Schema.Types.ObjectId,
        ref: 'Contact',
    },
    notes: {
        type: String,
        required: true,
    },
    hospital: {
        type: Schema.Types.ObjectId,
        ref: 'Hospital',
        required: true
    },
    user: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true
    }
}, {
    timestamps: true
});


export default mongoose.model<ICallLogs>('CallLogs', CallLogsSchema);