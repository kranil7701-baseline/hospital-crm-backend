import express from 'express';
import { getIDNs, getIDNById, createIDN, deleteIDN, updateIDN, getAllIDNsDeals, getAllIDNsDeals00 } from '../controller/idn.ts';
import { protect, authorizeRoles } from '../middleware/authMiddleware.ts';
import { UserRole } from '../model/User.ts';

const router = express.Router();

router.use(protect);

router.get('/all-idns', getIDNs);
// router.get('/all-idns-deals', getAllIDNsDeals);
router.get('/all-idns-deals', getAllIDNsDeals);
router.get('/:id', getIDNById);
router.post('/create', authorizeRoles(UserRole.ADMIN), createIDN);
router.put('/:id', authorizeRoles(UserRole.ADMIN), updateIDN);
router.delete('/:id', authorizeRoles(UserRole.ADMIN), deleteIDN);

export default router;
