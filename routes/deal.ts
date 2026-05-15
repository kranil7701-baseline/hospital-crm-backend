import express from 'express';
import { getDeals, createDeal, updateDealProductStage, removeDeal, addProductToDeal, updateDeal, getDashboardStats, getClosedWonDeals } from '../controller/deal.ts';
import { protect, authorizeRoles } from '../middleware/authMiddleware.ts';

const router = express.Router();

router.use(protect);
router.get('/all-deals', getDeals);
router.post('/create', createDeal);

router.put('/stage/update-deal-stage', updateDealProductStage)


// Single Hospital Page
router.delete("/delete/product", removeDeal);
router.post("/add/product", addProductToDeal);
router.put("/update", updateDeal);




router.get("/stats/get-dashboard-stats", getDashboardStats);
router.get("/stats/closed-won", getClosedWonDeals);

export default router;