import express from 'express';
import { getAuthUrlCert, microsoftCallbackCert, getMessagesCert } from '../controller/graphCertificateAPI.ts';
import { protect } from '../middleware/authMiddleware.ts';

const router = express.Router();

/**
 * Route: /api/graph-cert/auth-url
 * Description: Get Microsoft Graph Auth URL using Certificate Authentication
 */
router.get('/auth-url', protect, getAuthUrlCert);

/**
 * Route: /api/graph-cert/callback
 * Description: Handle Microsoft Graph Callback using Certificate Authentication
 */
router.get('/callback', microsoftCallbackCert);

/**
 * Route: /api/graph-cert/messages
 * Description: Fetch user messages using certificate-based access tokens
 */
router.get('/messages', protect, getMessagesCert);

export default router;
