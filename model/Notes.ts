import mongoose, { Document, Schema } from 'mongoose';

export interface INotes extends Document {
    notes: string;
    hospital: mongoose.Types.ObjectId;
    user: mongoose.Types.ObjectId;
    products?: mongoose.Types.ObjectId[];
    createdAt: Date;
    updatedAt: Date;
}

const NotesSchema: Schema = new Schema({
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
    },
    products: [{
        type: Schema.Types.ObjectId,
        ref: 'Product',
    }]
}, {
    timestamps: true
});

export default mongoose.model<INotes>('Notes', NotesSchema);