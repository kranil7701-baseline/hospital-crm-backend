import express from 'express';
import { getNotes, getNoteById, createNote, updateNote, deleteNote } from '../controller/notes.ts';
import { protect } from '../middleware/authMiddleware.ts';

const router = express.Router();

router.use(protect);

router.get('/all-notes', getNotes);
router.get('/:id', getNoteById);
router.post('/create', createNote);
router.put('/:id', updateNote);
router.delete('/:id', deleteNote);

export default router;
