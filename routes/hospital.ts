import express from "express";
import {
  getHospitals,
  getHospitalByHospitalId,
  createHospital,
  deleteHospital,
  updateHospital,
  getHospitalsByIDN,
  getAllHospitalsDeals,

  // getAllHospitalsDeals00,
  HospitalIDName,
} from "../controller/hospital.ts";
import { protect, authorizeRoles } from "../middleware/authMiddleware.ts";
import User, { UserRole } from "../model/User.ts";

const router = express.Router();

router.use(protect);

router.get("/hospiptal-id-name", HospitalIDName);

router.get("/all-hospitals", getHospitals);
router.get("/all-hospitals-deals", getAllHospitalsDeals);
router.get("/:id", getHospitalByHospitalId);
router.post(
  "/create",
  authorizeRoles(UserRole.ADMIN, UserRole.CUSTOMER_SUCCESS),
  createHospital,
);
router.put("/:id", updateHospital);
router.delete(
  "/:id",
  authorizeRoles(UserRole.ADMIN, UserRole.CUSTOMER_SUCCESS),
  deleteHospital,
);
router.get("/idn/:idnId", getHospitalsByIDN);

export default router;
