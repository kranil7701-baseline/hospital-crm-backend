import express from "express";
import {
    uploadAndCreateDocument,
    getHospitalDocuments,
    deleteDocument
} from "../controller/upload.ts";
import { upload } from "../middleware/upload.ts";
import { protect } from "../middleware/authMiddleware.ts";

const router = express.Router();

router.use(protect);

router.post("/upload", upload.single("file"), uploadAndCreateDocument);
router.get("/hospital/:hospitalId", getHospitalDocuments);
router.delete("/:id", deleteDocument);

export default router;