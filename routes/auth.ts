import express from 'express';
import { signup, login, getMe, logout } from '../controller/auth.ts';

import { protect } from '../middleware/authMiddleware.ts';

const router = express.Router();

router.post('/signup', signup);
router.post('/login', login);
router.get('/me', getMe);
router.get('/logout', logout);


export default router;
