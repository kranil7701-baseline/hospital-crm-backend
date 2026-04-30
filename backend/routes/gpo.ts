import express from 'express';
import { getGPOs, getGPOById, createGPO, deleteGPO, updateGPO, getAllGPODeals } from '../controller/gpo.ts';
import { protect, authorizeRoles } from '../middleware/authMiddleware.ts';

const router = express.Router();

router.use(protect);

router.get('/all-gpos', getGPOs);
router.get('/all-gpo-deals', getAllGPODeals);
router.get('/:id', getGPOById);
router.post('/create', createGPO);
router.put('/:id', updateGPO);
router.delete('/:id', deleteGPO);


export default router;