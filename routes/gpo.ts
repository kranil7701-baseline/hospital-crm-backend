import express from "express";
import {
  getGPOs,
  getGPOById,
  createGPO,
  deleteGPO,
  updateGPO,
  getAllGPODeals,
  getGPOHospitalDealsbyID,
  GetGPONameIDS,
} from "../controller/gpo.ts";
import { protect, authorizeRoles } from "../middleware/authMiddleware.ts";
import { UserRole } from "../model/User.ts";

const router = express.Router();

// router.use(protect);

router.get("/gpo-name-id", GetGPONameIDS);
router.get("/deals-by-gpo", getGPOHospitalDealsbyID);
router.get("/all-gpos", getGPOs);
router.get("/all-gpo-deals", getAllGPODeals);
router.get("/deals-by-gpo", getGPOHospitalDealsbyID);
router.get("/:id", getGPOById);
router.post(
  "/create",
  authorizeRoles(UserRole.ADMIN, UserRole.CUSTOMER_SUCCESS),
  createGPO,
);
router.put(
  "/:id",
  authorizeRoles(UserRole.ADMIN, UserRole.CUSTOMER_SUCCESS),
  updateGPO,
);
router.delete(
  "/:id",
  authorizeRoles(UserRole.ADMIN, UserRole.CUSTOMER_SUCCESS),
  deleteGPO,
);

export default router;
