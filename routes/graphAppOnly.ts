import express from "express";
import {
  getMailboxMessages,
  sendMailFromMailbox,
  getSentEmailsFromDB,
  getReceivedEmailsFromDB,
  replyToMessage,
  getAttachmentContent,
  syncHospitalEmails,
} from "../controller/graphAppOnlyAPI.ts";
import { protect } from "../middleware/authMiddleware.ts";

const router = express.Router();

router.get("/messages/:email", protect, getMailboxMessages); 

router.get("/sent-emails", protect, getSentEmailsFromDB);
router.get("/received-emails", protect, getReceivedEmailsFromDB);

router.post("/sync", protect, syncHospitalEmails);
router.post("/sync-hospital", protect, syncHospitalEmails);
router.post("/send", protect, sendMailFromMailbox);
router.post("/reply", protect, replyToMessage);

router.get(
  "/attachment/:userId/:messageId/:attachmentId",
  getAttachmentContent,
);

export default router;
