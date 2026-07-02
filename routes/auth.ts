import express from 'express';
import { signup, login, getMe, logout, changePassword } from '../controller/auth.ts';
import { protect } from '../middleware/authMiddleware.ts';

const router = express.Router();

router.post('/signup', signup);
router.post('/login', login);
router.get('/me', getMe);
router.get('/logout', logout);
router.post('/change-password', protect, changePassword);

export default router;