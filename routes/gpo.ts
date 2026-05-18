import express from 'express';
import { getGPOs, getGPOById, createGPO, deleteGPO, updateGPO, getAllGPODeals, getAllGPODeals00 } from '../controller/gpo.ts';
import { protect, authorizeRoles } from '../middleware/authMiddleware.ts';
import { UserRole } from '../model/User.ts';

const router = express.Router();

router.use(protect);

router.get('/all-gpos', getGPOs);
// router.get('/all-gpo-deals', getAllGPODeals);
router.get('/all-gpo-deals', getAllGPODeals);
router.get('/:id', getGPOById);
router.post('/create', authorizeRoles(UserRole.ADMIN), createGPO);
router.put('/:id', authorizeRoles(UserRole.ADMIN), updateGPO);
router.delete('/:id', authorizeRoles(UserRole.ADMIN), deleteGPO);


export default router;