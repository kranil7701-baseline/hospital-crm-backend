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

export default router;

/*

just to confirm, it is important that the Executive role has full visibility to the deals and pipelines. The CRM will serve as a real time roll-up of ARR and how much revenue is in the pipeline to close. I want to make sure that this is critical, not just having the access to view others' data

make a reply that 

ok I understand you just need to clarify me what can an executive do in CRM,  CAn Executive view all the data in the CRM just like Admin, Can Executive create hospital, Deals, GPO's, IDN's, users.



*/
