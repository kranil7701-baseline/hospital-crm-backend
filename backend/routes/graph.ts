import express from 'express';
import { getMessages, sendMail, getAuthUrl, microsoftCallback } from '../controller/graphAPI.ts';
import { protect } from '../middleware/authMiddleware.ts';

const router = express.Router();

// OAuth flow routes
router.get('/auth-url', getAuthUrl);
router.get('/callback', microsoftCallback);

// Protected Graph API routes
router.get('/messages', protect, getMessages);
router.post('/send-mail', protect, sendMail);

export default router;
