import express from 'express';
import { getProducts, getProductById, createProduct, updateProduct, deleteProduct } from '../controller/product.ts';
import { protect, authorizeRoles } from '../middleware/authMiddleware.ts';
import { UserRole } from '../model/User.ts';

const router = express.Router();

router.get('/all-products', getProducts);
router.get('/:id', protect, authorizeRoles(UserRole.ADMIN), getProductById);
router.post('/create', protect, authorizeRoles(UserRole.ADMIN), createProduct);
router.put('/:id', protect, authorizeRoles(UserRole.ADMIN), updateProduct);
router.delete('/:id', protect, authorizeRoles(UserRole.ADMIN), deleteProduct);

export default router;