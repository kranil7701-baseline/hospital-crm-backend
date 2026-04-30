import express from 'express';
import { subscribe, unsubscribe, sendNotification, getVapidPublicKey } from '../controller/pushNotification.ts';

const router = express.Router();

router.get('/vapid-public-key', getVapidPublicKey);
router.post('/subscribe', subscribe);
router.post('/unsubscribe', unsubscribe);
router.post('/send', sendNotification); // Optional: add auth middleware to protect this route

export default router;
