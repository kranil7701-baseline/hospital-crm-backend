import express from 'express';
import { getTasks, getTaskById, createTask, updateTask, deleteTask } from '../controller/task.ts';
import { protect } from '../middleware/authMiddleware.ts';

const router = express.Router();

router.use(protect);

router.get('/all-tasks', getTasks);
router.get('/:id', getTaskById);
router.post('/create', createTask);
router.put('/:id', updateTask);
router.delete('/:id', deleteTask);

export default router;
