import express from "express";
import {
  getMailboxMessages,
  sendMailFromMailbox,
  syncMailboxMessages,
  getSentEmailsFromDB,
  getReceivedEmailsFromDB,
  replyToMessage,
  getAttachmentContent,
  syncMailboxMessagesByDate,
  syncHospitalEmails

} from "../controller/graphAppOnlyAPI.ts";
import { protect } from "../middleware/authMiddleware.ts";

const router = express.Router();

router.get("/messages/:email", protect, getMailboxMessages); // get email messages from graph API outllok Azure

router.get("/sent-emails", protect, getSentEmailsFromDB); // Get Sent Emails from DB
router.get("/received-emails", protect, getReceivedEmailsFromDB); // Get Received Emails from DB

router.post("/sync", protect, syncHospitalEmails); // Sync Emails
router.post("/send", protect, sendMailFromMailbox); // Send Emails
router.post("/reply", protect, replyToMessage); // Reply to Emails

router.get(
  "/attachment/:userId/:messageId/:attachmentId",
  protect,
  getAttachmentContent,
);

export default router;
