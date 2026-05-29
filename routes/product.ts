import express from "express";
import {
  getProducts,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
  getProductsAdmin,
} from "../controller/product.ts";
import { protect, authorizeRoles } from "../middleware/authMiddleware.ts";
import { UserRole } from "../model/User.ts";

const router = express.Router();

router.get("/all-products", getProducts);
router.get("/all-products-admin", getProductsAdmin);
router.get(
  "/:id",
  protect,
  authorizeRoles(UserRole.ADMIN, UserRole.CUSTOMER_SUCCESS),
  getProductById,
);
router.post(
  "/create",
  protect,
  authorizeRoles(UserRole.ADMIN, UserRole.CUSTOMER_SUCCESS),
  createProduct,
);
router.put(
  "/:id",
  protect,
  authorizeRoles(UserRole.ADMIN, UserRole.CUSTOMER_SUCCESS),
  updateProduct,
);
router.delete(
  "/:id",
  protect,
  authorizeRoles(UserRole.ADMIN, UserRole.CUSTOMER_SUCCESS),
  deleteProduct,
);

export default router;
