import express from 'express';
import { getActivities, deleteActivity, createActivity, getDashboardActivity } from '../controller/activity.ts';
import { protect } from '../middleware/authMiddleware.ts';

const router = express.Router();

router.use(protect);

router.get('/dashboard-activity', getDashboardActivity);
router.get('/all-activities', getActivities);
router.delete('/delete', deleteActivity);
router.post('/create', createActivity);

export default router;