import mongoose, { Document, Schema } from 'mongoose';

export interface IProduct extends Document {
    name: string;
    description: string;
    Marketprice: number;
    createdAt: Date;
    updatedAt: Date;
}

const ProductSchema: Schema = new Schema({
    name: {
        type: String,
        required: true,
        unique: true,
        trim: true
    },
    description: {
        type: String,
        required: true,
        trim: true
    },
    // Marketprice: {
    //     type: Number,
    //     required: true
    // }
}, {
    timestamps: true
});

export default mongoose.model<IProduct>('Product', ProductSchema);