import express from "express";
import {
  getIDNs,
  getIDNById,
  createIDN,
  deleteIDN,
  updateIDN,
  getAllIDNsDeals,
  getIDNHospitalDealsbyID,
  GetIDNNameIDS,
  getAllIDNsDeals00,
  addIDNNote,
  updateIDNNote,
  deleteIDNNote,
} from "../controller/idn.ts";
import { protect, authorizeRoles } from "../middleware/authMiddleware.ts";
import { UserRole } from "../model/User.ts";

const router = express.Router();

router.use(protect);

router.get("/idn-name-id", GetIDNNameIDS);

router.get("/all-idns", getIDNs);
router.get("/all-idns-deals", getAllIDNsDeals);
router.get("/deals-by-idn", getIDNHospitalDealsbyID);
router.get("/:id", getIDNById);
router.post(
  "/create",
  authorizeRoles(UserRole.ADMIN, UserRole.CUSTOMER_SUCCESS),
  createIDN,
);
router.put(
  "/:id",
  authorizeRoles(UserRole.ADMIN, UserRole.CUSTOMER_SUCCESS),
  updateIDN,
);
router.delete(
  "/:id",
  authorizeRoles(UserRole.ADMIN, UserRole.CUSTOMER_SUCCESS),
  deleteIDN,
);

// IDN Notes Endpoints
router.post("/:id/notes", addIDNNote);
router.put("/:id/notes/:noteId", updateIDNNote);
router.delete("/:id/notes/:noteId", deleteIDNNote);

export default router;
