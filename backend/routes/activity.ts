import express from 'express';
import { getActivities, deleteActivity, createActivity } from '../controller/activity.ts';
import { protect } from '../middleware/authMiddleware.ts';

const router = express.Router();

router.use(protect);

router.get('/all-activities', getActivities);
router.delete('/delete', deleteActivity);
router.post('/create', createActivity);

export default router;
