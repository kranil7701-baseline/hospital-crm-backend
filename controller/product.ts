import type { Request, Response } from 'express';
import Product from '../model/Product.ts';

export const getProducts = async (req: Request, res: Response): Promise<void> => {
    try {
        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 10;
        const search = (req.query.search as string) || "";

        const skip = (page - 1) * limit;

        const searchQuery = search
            ? {
                $or: [
                    { name: { $regex: search, $options: "i" } },
                    { description: { $regex: search, $options: "i" } }
                ]
            }
            : {};

        const products = await Product.find(searchQuery)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);

        const total = await Product.countDocuments(searchQuery);

        res.status(200).json({
            success: true,
            page,
            limit,
            totalProducts: total,
            totalPages: Math.ceil(total / limit),
            data: products
        });
    } catch (error: any) {
        res.status(500).json({
            success: false,
            message: "Failed to retrieve products",
            error: error.message
        });
    }
};

export const getProductById = async (req: Request, res: Response): Promise<void> => {
    try {
        const { id } = req.params;
        const product = await Product.findById(id);

        if (!product) {
            res.status(404).json({
                success: false,
                message: 'Product not found'
            });
            return;
        }

        res.status(200).json({
            success: true,
            data: product
        });
    } catch (error: any) {
        res.status(500).json({
            success: false,
            message: 'Error fetching product',
            error: error.message
        });
    }
};

export const createProduct = async (req: Request, res: Response): Promise<void> => {
    try {
        const product = new Product(req.body);
        await product.save();

        res.status(201).json({
            success: true,
            data: product
        });
    } catch (error: any) {
        res.status(400).json({
            success: false,
            message: 'Failed to create product',
            error: error.message
        });
    }
};

export const updateProduct = async (req: Request, res: Response): Promise<void> => {
    try {
        const { id } = req.params;
        // console.log(req.body)
        const updatedProduct = await Product.findByIdAndUpdate(
            id,
            req.body,
            { new: true, runValidators: true }
        );

        if (!updatedProduct) {
            res.status(404).json({ success: false, message: 'Product not found' });
            return;
        }

        res.status(200).json({
            success: true,
            data: updatedProduct
        });
    } catch (error: any) {
        res.status(500).json({
            success: false,
            message: 'Failed to update product',
            error: error.message
        });
    }
};

export const deleteProduct = async (req: Request, res: Response): Promise<void> => {
    try {
        const { id } = req.params;
        const product = await Product.findByIdAndDelete(id);

        if (!product) {
            res.status(404).json({ success: false, message: 'Product not found' });
            return;
        }

        res.status(200).json({ success: true, message: 'Product deleted successfully' });
    } catch (error: any) {
        res.status(500).json({ success: false, message: 'Error deleting product', error: error.message });
    }
};