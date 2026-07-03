import mongoose, { Document, Schema } from 'mongoose';

export interface ITask extends Document {
    title: string;
    description: string;
    dueDate: Date;
    hospital: mongoose.Types.ObjectId;
    user: mongoose.Types.ObjectId;
    completed: boolean;
    reminders: ('email' | 'push')[];
    products?: mongoose.Types.ObjectId[];
    secondaryAssignees?: mongoose.Types.ObjectId[];
    createdAt: Date;
    updatedAt: Date;
}

const TaskSchema: Schema = new Schema({
    title: {
        type: String,
        required: true,
        trim: true,
    },
    description: {
        type: String,
        trim: true,
    },
    dueDate: {
        type: Date,
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
    },
    completed: {
        type: Boolean,
        default: false,
    },
    reminders: {
        type: [String],
        enum: ['email', 'push'],
        default: []
    },
    products: [{
        type: Schema.Types.ObjectId,
        ref: 'Product',
    }],
    secondaryAssignees: [{
        type: Schema.Types.ObjectId,
        ref: 'User',
    }]
}, {
    timestamps: true
});


export default mongoose.model<ITask>('Task', TaskSchema);