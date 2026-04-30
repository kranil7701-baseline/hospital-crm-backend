import express from 'express';
import { getContacts, getContactById, createContact, deleteContact, updateContact } from '../controller/contact.ts';
import { protect, authorizeRoles } from '../middleware/authMiddleware.ts';
import { UserRole } from '../model/User.ts';

const router = express.Router();

router.use(protect);

router.get('/all-contacts', getContacts);
router.get('/:id', getContactById);
router.post('/create', createContact);
router.put('/:id', updateContact);
router.delete('/:id', deleteContact);

export default router;
