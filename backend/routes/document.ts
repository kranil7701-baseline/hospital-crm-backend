import express from "express";
import { 
    uploadAndCreateDocument, 
    getHospitalDocuments, 
    deleteDocument 
} from "../controller/upload.ts";
import { upload } from "../middleware/upload.ts";
import { protect } from "../middleware/authMiddleware.ts";

const router = express.Router();

router.post("/upload", protect, upload.single("file"), uploadAndCreateDocument);
router.get("/hospital/:hospitalId", protect, getHospitalDocuments);
router.delete("/:id", protect, deleteDocument);

export default router;
