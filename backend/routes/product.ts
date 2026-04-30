import express from 'express';
import { getProducts, getProductById, createProduct, updateProduct, deleteProduct } from '../controller/product.ts';
import { protect, authorizeRoles } from '../middleware/authMiddleware.ts';
import { UserRole } from '../model/User.ts';

const router = express.Router();
router.use(protect);

router.get('/all-products', authorizeRoles(UserRole.ADMIN), getProducts);
router.get('/:id', authorizeRoles(UserRole.ADMIN), getProductById);
router.post('/create', authorizeRoles(UserRole.ADMIN), createProduct);
router.put('/:id', authorizeRoles(UserRole.ADMIN), updateProduct);
router.delete('/:id', authorizeRoles(UserRole.ADMIN), deleteProduct);

export default router;