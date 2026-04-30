import express from 'express';
import { getPipelines, getPipelineById, createPipeline, deletePipeline, updatePipeline } from '../controller/pipeline.ts';
import { protect, authorizeRoles } from '../middleware/authMiddleware.ts';
import { UserRole } from '../model/User.ts';

const router = express.Router();

router.use(protect);

router.get('/all-pipelines', getPipelines);
router.get('/:id', getPipelineById);
router.post('/create', authorizeRoles(UserRole.EXECUTIVE, UserRole.ADMIN), createPipeline);
router.put('/:id', authorizeRoles(UserRole.EXECUTIVE, UserRole.ADMIN), updatePipeline);
router.delete('/:id', authorizeRoles(UserRole.EXECUTIVE, UserRole.ADMIN), deletePipeline);

export default router;