import express from 'express';
import { subscribe, unsubscribe, sendNotification, getVapidPublicKey } from '../controller/pushNotification.ts';
import { protect, authorizeRoles } from '../middleware/authMiddleware.ts';
const router = express.Router();

router.use(protect);

router.get('/vapid-public-key', getVapidPublicKey);
router.post('/subscribe', subscribe);
router.post('/unsubscribe', unsubscribe);
router.post('/send', sendNotification); // Optional: add auth middleware to protect this route

export default router;
