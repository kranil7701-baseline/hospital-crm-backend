import express from "express";
import {
  getDeals,
  createDeal,
  updateDealProductStage,
  removeDeal,
  addProductToDeal,
  updateDeal,
  getDashboardStats,
  getClosedWonDeals,
  getImplementedDeals,
  HospitalProductCount,
  DealsTesting,
} from "../controller/deal.ts";
import { protect, authorizeRoles } from "../middleware/authMiddleware.ts";

const router = express.Router();

router.use(protect);
router.get("/all-deals", getDeals);
router.post("/create", createDeal);

router.put("/stage/update-deal-stage", updateDealProductStage);

// Single Hospital Page
router.delete("/delete/product", removeDeal);
router.post("/add/product", addProductToDeal);
router.put("/update", updateDeal);

router.get("/stats/get-dashboard-stats", getDashboardStats);
router.get("/stats/closed-won", getClosedWonDeals);
router.get("/stats/implemented", getImplementedDeals);

router.get("/stats/hospital-product-count", HospitalProductCount);

router.get("/stats/all-deals", DealsTesting);

export default router;
