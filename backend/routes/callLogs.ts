import express from 'express';
import { getCallLogs, getCallLogById, createCallLog, updateCallLog, deleteCallLog } from '../controller/callLogs.ts';
import { protect } from '../middleware/authMiddleware.ts';

const router = express.Router();

router.use(protect);

router.get('/all-call-logs', getCallLogs);
router.get('/:id', getCallLogById);
router.post('/create', createCallLog);
router.put('/:id', updateCallLog);
router.delete('/:id', deleteCallLog);

export default router;
