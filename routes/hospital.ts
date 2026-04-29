import express from 'express';
import { getHospitals, getHospitalByHospitalId, createHospital, deleteHospital, updateHospital, getHospitalsByIDN, getAllHospitalsDeals } from '../controller/hospital.ts';
import { protect, authorizeRoles } from '../middleware/authMiddleware.ts';
import { UserRole } from '../model/User.ts';

const router = express.Router();

router.use(protect);

router.get('/all-hospitals', getHospitals);
router.get('/all-hospitals-deals', getAllHospitalsDeals);
router.get('/:id', getHospitalByHospitalId);
router.post('/create', createHospital);
router.put('/:id', updateHospital);
router.delete('/:id', deleteHospital);
router.get('/idn/:idnId', getHospitalsByIDN)

export default router;