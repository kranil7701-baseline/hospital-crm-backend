import express from "express";
import {
  getUsers,
  getUserById,
  createUser,
  updateUser,
  deleteUser,
  updateUserStatus,
  getUsersAdmin,
} from "../controller/user.ts";
import { protect, authorizeRoles } from "../middleware/authMiddleware.ts";
import { UserRole } from "../model/User.ts";

const router = express.Router();
router.use(protect);

router.get("/all-users", getUsers);
router.get(
  "/all-users-admin",
  authorizeRoles(UserRole.ADMIN, UserRole.CUSTOMER_SUCCESS),
  getUsersAdmin,
);
router.post(
  "/create",
  authorizeRoles(UserRole.ADMIN, UserRole.CUSTOMER_SUCCESS),
  createUser,
);
router.get(
  "/:id",
  authorizeRoles(UserRole.ADMIN, UserRole.CUSTOMER_SUCCESS),
  getUserById,
);
router.put(
  "/:id",
  authorizeRoles(UserRole.ADMIN, UserRole.CUSTOMER_SUCCESS),
  updateUser,
);
router.patch(
  "/status",
  authorizeRoles(UserRole.ADMIN, UserRole.CUSTOMER_SUCCESS),
  updateUserStatus,
);
router.delete(
  "/:id",
  authorizeRoles(UserRole.ADMIN, UserRole.CUSTOMER_SUCCESS),
  deleteUser,
);

export default router;
