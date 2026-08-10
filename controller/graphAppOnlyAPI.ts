import type { Request, Response } from "express";
import type { AuthRequest } from "../middleware/authMiddleware.ts";
import Email from "../model/email.ts";
import User from "../model/User.ts";
import Hospital from "../model/Hospital.ts";
import Contact from "../model/Contact.ts";
import { getAppOnlyToken } from "../helper/graphEmail.ts";
import mongoose from "mongoose";

const normalizeSubject = (subject: string): string => {
  if (!subject) return "";
  return subject.replace(/^(re|fw|fwd|aw|reply|forward):\s*/i, "").trim();
};

const processMessageAttachments = async (
  accessToken: string,
  userId: string,
  message: any,
) => {
  // Initialize attachments array for the message object
  message.attachments = [];

  // Skip API call entirely if there are no attachments and no inline images
  const hasCid = message.body?.content?.includes("cid:");
  if (!message.hasAttachments && !hasCid) {
    return;
  }

  try {
    const response = await fetch(
      `https://graph.microsoft.com/v1.0/users/${userId}/messages/${message.id}/attachments`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );

    if (!response.ok) {
      const errText = await response.text();
      console.error(
        `Failed to fetch attachments for message ${message.id}: ${response.status} ${errText}`,
      );
      return;
    }

    const data = await response.json();
    const attachments = data.value || [];

    let bodyContent = message.body?.content || "";
    let replacedCount = 0;

    // 1. Map all available attachments by their CID and Name for quick lookup
    const attachmentMap = new Map<string, any>();
    attachments.forEach((att: any) => {
      if (att.contentId) {
        const cleanId = att.contentId.replace(/[<>]/g, "");
        attachmentMap.set(cleanId.toLowerCase(), att);
      }
      if (att.name) {
        attachmentMap.set(att.name.toLowerCase(), att);
      }
    });

    // 2. Construct local URLs and update the map
    const storedAttachments: any[] = [];
    for (const attachment of attachments) {
      if (attachment.id) {
        try {
          const backendBaseUrl =
            process.env.BACKEND_URL ||
            (process.env.NODE_ENV === "production"
              ? `${process.env.BACKEND_URL}`
              : "http://localhost:8000");

          const fileUrl = `${backendBaseUrl}/api/graph-app/attachment/${userId}/${message.id}/${attachment.id}`;

          const storedAtt = {
            name: attachment.name || "attachment",
            contentType: attachment.contentType || "application/octet-stream",
            contentId: attachment.contentId || "",
            contentBytes: "", // We no longer store bytes in the database to save space
            fileUrl: fileUrl,
            isInline: attachment.isInline || !!attachment.contentId,
          };
          storedAttachments.push(storedAtt);

          // Update our lookup map with the new fileUrl
          if (attachment.contentId) {
            const key = attachment.contentId.replace(/[<>]/g, "").toLowerCase();
            const mapAtt = attachmentMap.get(key);
            if (mapAtt) mapAtt.fileUrl = fileUrl;
          }
          if (attachment.name) {
            const key = attachment.name.toLowerCase();
            const mapAtt = attachmentMap.get(key);
            if (mapAtt) mapAtt.fileUrl = fileUrl;
          }
        } catch (fileError) {
          console.error("Error saving attachment to disk:", fileError);
        }
      }
    }

    // 3. Robust Body Replacement: Scan the body for ANY "cid:" patterns
    if (bodyContent) {
      // Extremely permissive regex to find anything that looks like a CID
      const cidMatches = bodyContent.match(/cid:[^"'\s>)]+/gi);

      if (cidMatches) {
        for (const match of cidMatches) {
          const cidPart = match.replace(/cid:<?/i, "").replace(/>?$/i, "");
          let cleanCid = cidPart.replace(/[<>]/g, "").toLowerCase();

          // Try direct match in current message
          let att = attachmentMap.get(cleanCid);

          // Try match without extension
          if (!att && cleanCid.includes(".")) {
            const baseCid = cleanCid.substring(0, cleanCid.lastIndexOf("."));
            att = attachmentMap.get(baseCid);
          }

          // Try match by stripping everything after @ (common in Outlook)
          if (!att && cleanCid.includes("@")) {
            const prefix = cleanCid.split("@")[0];
            att = attachmentMap.get(prefix);
          }

          // Try stripping 'ii_' prefix (common in Gmail/Outlook threads)
          if (!att && cleanCid.startsWith("ii_")) {
            const stripped = cleanCid.substring(3);
            att = attachmentMap.get(stripped);
          }

          // Try URL decoding
          if (!att) {
            try {
              const decodedCid = decodeURIComponent(cleanCid);
              att = attachmentMap.get(decodedCid);
            } catch (e) { }
          }

          // Last resort: search for ANY attachment that contains this CID string in its name or ID
          if (!att) {
            for (const [key, value] of attachmentMap.entries()) {
              if (key.includes(cleanCid) || cleanCid.includes(key)) {
                att = value;
                break;
              }
            }
          }

          let targetUrl = att?.fileUrl;

          // 3b. Batch lookup: If not found in current message, look in other messages in the CURRENT SYNC BATCH
          // (This fixes the race condition where the original message and reply are in the same sync batch)
          if (
            !targetUrl &&
            message.conversationId &&
            Array.isArray((global as any).currentSyncBatch)
          ) {
            const otherMsg = (global as any).currentSyncBatch.find(
              (m: any) =>
                m.conversationId === message.conversationId &&
                m.attachments &&
                m.attachments.some(
                  (a: any) =>
                    (a.contentId &&
                      a.contentId.replace(/[<>]/g, "").toLowerCase() ===
                      cleanCid) ||
                    (a.name && a.name.toLowerCase() === cleanCid),
                ),
            );
            if (otherMsg) {
              const batchAtt = otherMsg.attachments.find(
                (a: any) =>
                  (a.contentId &&
                    a.contentId.replace(/[<>]/g, "").toLowerCase() ===
                    cleanCid) ||
                  (a.name && a.name.toLowerCase() === cleanCid),
              );
              if (batchAtt && batchAtt.fileUrl) {
                targetUrl = batchAtt.fileUrl;
              }
            }
          }

          // 4. Thread-wide lookup: If still not found, look in the database
          if (!targetUrl && message.conversationId) {
            try {
              const threadMessage = await Email.findOne({
                conversationId: message.conversationId,
                "attachments.contentId": new RegExp(
                  cleanCid.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
                  "i",
                ),
                "attachments.fileUrl": { $exists: true, $ne: "" },
              }).select("attachments");

              if (threadMessage && threadMessage.attachments) {
                const threadAtt = threadMessage.attachments.find(
                  (a) =>
                    (a.contentId &&
                      a.contentId.replace(/[<>]/g, "").toLowerCase() ===
                      cleanCid) ||
                    (a.name && a.name.toLowerCase() === cleanCid),
                );
                if (threadAtt && threadAtt.fileUrl) {
                  targetUrl = threadAtt.fileUrl;
                }
              }
            } catch (err) {
              console.error("    * Thread lookup error:", err);
            }
          }

          // 5. Global Fallback: Search the ENTIRE database for any email with this CID
          // Use this as a last resort for common logos/images
          if (!targetUrl) {
            try {
              const globalMatch = await Email.findOne({
                "attachments.contentId": new RegExp(
                  cleanCid.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
                  "i",
                ),
                "attachments.fileUrl": { $exists: true, $ne: "" },
              }).select("attachments");

              if (globalMatch && globalMatch.attachments) {
                const globalAtt = globalMatch.attachments.find(
                  (a) =>
                    (a.contentId &&
                      a.contentId.replace(/[<>]/g, "").toLowerCase() ===
                      cleanCid) ||
                    (a.name && a.name.toLowerCase() === cleanCid),
                );
                if (globalAtt && globalAtt.fileUrl) {
                  targetUrl = globalAtt.fileUrl;
                }
              }
            } catch (err) {
              console.error("    * Global search error:", err);
            }
          }

          if (targetUrl) {
            const escapedCid = cidPart.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            const replaceRegex = new RegExp(`cid:<?${escapedCid}>?`, "gi");
            bodyContent = bodyContent.replace(replaceRegex, targetUrl);
            replacedCount++;
          } else {
            const imgSrcRegex = new RegExp(
              `<img[^>]+src=["']cid:<?${cidPart.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}>?["']`,
              "i",
            );
            bodyContent = bodyContent.replace(imgSrcRegex, targetUrl || "");
          }
        }
      }

      // FINAL CATCH-ALL: Scan for any remaining src="cid:..." patterns that might have been missed
      const remainingCids = bodyContent.match(/src=["']cid:([^"'>\s]+)["']/gi);
      if (remainingCids && remainingCids.length > 0) {
        // ... previous logic repeats or we can just leave the log to see what they are
      }
    }

    // Update message object
    if (message.body && bodyContent) {
      message.body.content = bodyContent;
    }
    message.attachments = storedAttachments;
  } catch (error) {
    console.error(
      `Error processing attachments for message ${message.id}:`,
      error,
    );
  }
};

export const getMailboxMessages = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { email } = req.params;

    if (!email) {
      res
        .status(400)
        .json({ success: false, message: "Email is required in params" });
      return;
    }

    // 1. Get App Token
    const accessToken = await getAppOnlyToken();

    // 2. Call Graph API
    const graphResponse = await fetch(
      `https://graph.microsoft.com/v1.0/users/${email}/messages`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );

    const data = await graphResponse.json();

    if (!graphResponse.ok) {
      res.status(graphResponse.status).json({
        success: false,
        message: "Failed to fetch messages",
        error: data,
      });
      return;
    }

    const messages = data.value || [];

    res.status(200).json({
      success: true,
      mailbox: email,
      count: messages.length,
      data: messages,
    });
  } catch (error: any) {
    console.error("Graph Error:", error);
    res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

export const sendMailFromMailbox = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const { toEmail, subject, content, ccEmails, bccEmails } = req.body;
    const fromEmail = req.user?.email;

    if (!fromEmail || !toEmail || !subject || !content) {
      res.status(400).json({
        success: false,
        message:
          "Missing required fields (toEmail, subject, content) or user email",
      });
      return;
    }

    const accessToken = await getAppOnlyToken();

    let ccRecipients: any[] = [];
    if (ccEmails) {
      const ccList = Array.isArray(ccEmails)
        ? ccEmails
        : ccEmails.split(",").map((e: string) => e.trim());
      ccRecipients = ccList
        .filter((e: string) => e)
        .map((email: string) => ({
          emailAddress: { address: email },
        }));
    }

    let bccRecipients: any[] = [];
    if (bccEmails) {
      const bccList = Array.isArray(bccEmails)
        ? bccEmails
        : bccEmails.split(",").map((e: string) => e.trim());
      bccRecipients = bccList
        .filter((e: string) => e)
        .map((email: string) => ({
          emailAddress: { address: email },
        }));
    }

    const attachments: any[] = [];
    const cidRegex = /cid:<?([a-zA-Z0-9.\-_@]+)>?/g;
    let match;
    const foundCids = new Set<string>();

    while ((match = cidRegex.exec(content)) !== null) {
      if (match[1]) {
        foundCids.add(match[1]);
      }
    }

    if (foundCids.size > 0) {
      const cidList = Array.from(foundCids);
      const cidPrefixes = cidList.map((c) => c.split(".")[0]);

      const emailsWithAttachments = await Email.find({
        $or: [
          { "attachments.contentId": { $in: cidList } },
          { "attachments.contentId": { $in: cidPrefixes } },
        ],
      }).select("attachments");

      for (const cid of foundCids) {
        const cidPrefix = cid.split(".")[0];
        let foundAttachment = null;

        for (const emailDoc of emailsWithAttachments) {
          if (emailDoc.attachments) {
            foundAttachment = emailDoc.attachments.find(
              (a) => a.contentId === cid || a.contentId === cidPrefix,
            );
            if (foundAttachment) break;
          }
        }

        if (foundAttachment) {
          attachments.push({
            "@odata.type": "#microsoft.graph.fileAttachment",
            name: foundAttachment.name,
            contentType: foundAttachment.contentType,
            contentBytes: foundAttachment.contentBytes,
            contentId: cid,
            isInline: true,
          });
        }
      }
    }

    const mailPayload: any = {
      message: {
        subject: subject,
        body: {
          contentType: "HTML",
          content: content,
        },
        toRecipients: [
          {
            emailAddress: {
              address: toEmail,
            },
          },
        ],
        ccRecipients: ccRecipients,
        bccRecipients: bccRecipients,
        attachments: attachments,
      },
      saveToSentItems: "true",
    };

    const graphResponse = await fetch(
      `https://graph.microsoft.com/v1.0/users/${fromEmail}/sendMail`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(mailPayload),
      },
    );

    if (!graphResponse.ok) {
      const errorData = await graphResponse.json();
      res.status(graphResponse.status).json({
        success: false,
        message: "Failed to send email",
        error: errorData,
      });
      return;
    }

    res.status(200).json({
      success: true,
      message: `Email sent successfully from ${fromEmail}`,
    });
  } catch (error: any) {
    console.error("App-Only Send Mail Error:", error);
    res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

export const getSentEmailsFromDB = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    if (!req.user) {
      res
        .status(401)
        .json({ success: false, message: "User not authenticated" });
      return;
    }

    const { page = 1, search = "", hospitalId } = req.query;
    const limit = 10;
    const skip = (Number(page) - 1) * limit;
    const userEmail = req.user.email.toLowerCase();

    const baseMatch: any = {};
    if (hospitalId) {
      baseMatch.hospital = new mongoose.Types.ObjectId(hospitalId as string);
    }

    const threadingStages: any[] = [
      { $match: baseMatch },
      {
        $addFields: {
          threadId: {
            $ifNull: ["$conversationId", "$normalizedSubject", "$subject"],
          },
        },
      },
      { $sort: { receivedDateTime: -1 } },
      {
        $group: {
          _id: "$threadId",
          latestDoc: { $first: "$$ROOT" },
          hasSent: {
            $max: {
              $cond: [{ $eq: ["$from.address", userEmail] }, true, false],
            },
          },

          searchMatch: {
            $max: search
              ? {
                $or: [
                  {
                    $regexMatch: {
                      input: { $ifNull: ["$subject", ""] },
                      regex: search as string,
                      options: "i",
                    },
                  },
                  {
                    $regexMatch: {
                      input: { $ifNull: ["$from.address", ""] },
                      regex: search as string,
                      options: "i",
                    },
                  },
                  {
                    $regexMatch: {
                      input: { $ifNull: ["$bodyPreview", ""] },
                      regex: search as string,
                      options: "i",
                    },
                  },
                ],
              }
              : true,
          },
        },
      },

      { $match: { hasSent: true, searchMatch: true } },
    ];

    const emails = await Email.aggregate([
      ...threadingStages,
      { $replaceRoot: { newRoot: "$latestDoc" } },
      { $sort: { receivedDateTime: -1 } },
      { $skip: skip },
      { $limit: limit },
    ]);

    const countResult = await Email.aggregate([
      ...threadingStages,
      { $count: "total" },
    ]);
    const totalEmails = countResult.length > 0 ? countResult[0].total : 0;

    res.status(200).json({
      success: true,
      data: emails,
      pagination: {
        total: totalEmails,
        page: Number(page),
        limit: limit,
        totalPages: Math.ceil(totalEmails / limit),
      },
    });
  } catch (error: any) {
    console.error("Fetch Sent Emails Error:", error);
    res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

export const getReceivedEmailsFromDB = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    if (!req.user) {
      res
        .status(401)
        .json({ success: false, message: "User not authenticated" });
      return;
    }

    const { page = 1, search = "", hospitalId } = req.query;
    const limit = 10;
    const skip = (Number(page) - 1) * limit;
    const userEmail = req.user.email.toLowerCase();

    const baseMatch: any = {};
    if (hospitalId) {
      baseMatch.hospital = new mongoose.Types.ObjectId(hospitalId as string);
    }

    const threadingStages: any[] = [
      { $match: baseMatch },
      {
        $addFields: {
          threadId: {
            $ifNull: ["$conversationId", "$normalizedSubject", "$subject"],
          },
        },
      },
      { $sort: { receivedDateTime: -1 } },
      {
        $group: {
          _id: "$threadId",
          latestDoc: { $first: "$$ROOT" },
          hasReceived: {
            $max: {
              $cond: [{ $ne: ["$from.address", userEmail] }, true, false],
            },
          },

          searchMatch: {
            $max: search
              ? {
                $or: [
                  {
                    $regexMatch: {
                      input: { $ifNull: ["$subject", ""] },
                      regex: search as string,
                      options: "i",
                    },
                  },
                  {
                    $regexMatch: {
                      input: { $ifNull: ["$from.address", ""] },
                      regex: search as string,
                      options: "i",
                    },
                  },
                  {
                    $regexMatch: {
                      input: { $ifNull: ["$bodyPreview", ""] },
                      regex: search as string,
                      options: "i",
                    },
                  },
                ],
              }
              : true,
          },
        },
      },

      { $match: { hasReceived: true, searchMatch: true } },
    ];

    const emails = await Email.aggregate([
      ...threadingStages,
      { $replaceRoot: { newRoot: "$latestDoc" } },
      { $sort: { receivedDateTime: -1 } },
      { $skip: skip },
      { $limit: limit },
    ]);

    const countResult = await Email.aggregate([
      ...threadingStages,
      { $count: "total" },
    ]);
    const totalEmails = countResult.length > 0 ? countResult[0].total : 0;

    res.status(200).json({
      success: true,
      data: emails,
      pagination: {
        total: totalEmails,
        page: Number(page),
        limit: limit,
        totalPages: Math.ceil(totalEmails / limit),
      },
    });
  } catch (error: any) {
    console.error("Fetch Received Emails Error:", error);
    res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

export const replyToMessage = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const { messageId, comment, ccEmails, bccEmails } = req.body;
    const fromEmail = req.user?.email;

    if (!fromEmail || !messageId || !comment) {
      res.status(400).json({
        success: false,
        message: "Missing required fields (messageId, comment) or user email",
      });
      return;
    }

    const accessToken = await getAppOnlyToken();

    let ccListArray: any[] = [];
    if (ccEmails) {
      const ccList = Array.isArray(ccEmails)
        ? ccEmails
        : ccEmails.split(",").map((e: string) => e.trim());
      ccListArray = ccList
        .filter((e: string) => e)
        .map((email: string) => ({
          emailAddress: { address: email },
        }));
    }

    let bccListArray: any[] = [];
    if (bccEmails) {
      const bccList = Array.isArray(bccEmails)
        ? bccEmails
        : bccEmails.split(",").map((e: string) => e.trim());
      bccListArray = bccList
        .filter((e: string) => e)
        .map((email: string) => ({
          emailAddress: { address: email },
        }));
    }

    // 2. Prepare the Payload
    const payload: any = {
      comment: comment,
    };

    if (ccListArray.length > 0 || bccListArray.length > 0) {
      payload.message = {};
      if (ccListArray.length > 0) payload.message.ccRecipients = ccListArray;
      if (bccListArray.length > 0) payload.message.bccRecipients = bccListArray;
    }

    const graphResponse = await fetch(
      `https://graph.microsoft.com/v1.0/users/${fromEmail}/messages/${messageId}/reply`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      },
    );

    if (!graphResponse.ok) {
      const errorData = await graphResponse.json();
      res.status(graphResponse.status).json({
        success: false,
        message: "Failed to reply to email",
        error: errorData,
      });
      return;
    }

    res.status(200).json({
      success: true,
      message: `Reply sent successfully from ${fromEmail}`,
    });
  } catch (error: any) {
    console.error("App-Only Reply Mail Error:", error);
    res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

const EIGHT_MONTHS_MS = 8 * 30 * 24 * 60 * 60 * 1000;

/** Check if a contact email appears in the message envelope (from, to, cc, bcc) */
function isContactInEnvelope(msg: any, contactEmail: string): boolean {
  const lower = contactEmail.toLowerCase();
  const all: string[] = [
    msg.from?.emailAddress?.address,
    ...(msg.toRecipients || []).map((r: any) => r.emailAddress?.address),
    ...(msg.ccRecipients || []).map((r: any) => r.emailAddress?.address),
    ...(msg.bccRecipients || []).map((r: any) => r.emailAddress?.address),
  ];
  return all.some((a) => a && a.toLowerCase() === lower);
}

/** Search one user's mailbox for a contact email, return envelope matches within date range */
async function searchUserMailboxForContact(
  accessToken: string,
  userEmail: string,
  contactEmail: string,
  eightMonthsAgo: Date,
  select: string,
  crmUserId: mongoose.Types.ObjectId,
  hospitalId: mongoose.Types.ObjectId,
): Promise<any[]> {
  const results: any[] = [];
  const fetchedIds = new Set<string>();
  const messages: any[] = [];

  // Query 1: Direct live filter for incoming emails (instant, covers calendar invites)
  try {
    const filterQuery = `from/emailAddress/address eq '${contactEmail}' and receivedDateTime ge ${eightMonthsAgo.toISOString()}`;
    const filterUrl = `https://graph.microsoft.com/v1.0/users/${userEmail}/messages?$filter=${encodeURIComponent(filterQuery)}&$top=100&$select=${select}`;
    const filterRes: any = await fetch(filterUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (filterRes.ok) {
      const filterData: any = await filterRes.json();


      for (const m of filterData.value || []) {
        if (!fetchedIds.has(m.id)) {
          fetchedIds.add(m.id);
          messages.push(m);
        }
      }
    }
  } catch (err: any) {
    console.warn(`[Email Sync] Filter query failed for ${userEmail}: ${err.message}`);
  }

  // Query 2: Search query for other messages (eventual, covers sent and CC'd)
  try {
    const kql = `"${contactEmail}"`;
    let searchUrl: string | null = `https://graph.microsoft.com/v1.0/users/${userEmail}/messages?$search=${encodeURIComponent(kql)}&$top=100&$select=${select}`;
    while (searchUrl) {
      const searchRes: any = await fetch(searchUrl, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          ConsistencyLevel: "eventual",
        },
      });
      if (!searchRes.ok) {
        const errData: any = await searchRes.json();
        const errMsg = errData?.error?.message || "";
        if (errMsg.includes("is invalid") || errMsg.includes("does not exist") || errMsg.includes("not found")) {
          console.warn(`Skipping ${userEmail} — not a valid Microsoft 365 user`);
        } else {
          console.warn(`Graph API error searching ${userEmail}: ${errMsg}`);
        }
        break;
      }
      const searchData: any = await searchRes.json();


      const value = searchData.value || [];
      if (value.length === 0) break;
      
      for (const m of value) {
        if (!fetchedIds.has(m.id)) {
          fetchedIds.add(m.id);
          messages.push(m);
        }
      }
      searchUrl = searchData["@odata.nextLink"] || null;
    }
  } catch (err: any) {
    console.warn(`[Email Sync] Search query failed for ${userEmail}: ${err.message}`);
  }

  // 1. Gather all conversation IDs from directly matched emails (Filter & Search)
  const seedConversationIds = new Set<string>();
  for (const m of messages) {
    if (m.conversationId) {
      seedConversationIds.add(m.conversationId);
    }
  }

  // 2. Gather all conversation IDs already stored in the DB for this hospital
  try {
    const existingThreadIds = await Email.find({ hospital: hospitalId }).distinct("conversationId");
    for (const id of existingThreadIds) {
      if (id) seedConversationIds.add(id);
    }
  } catch (err: any) {
    console.warn(`[Email Sync] Failed to query existing conversation IDs: ${err.message}`);
  }

  // 3. Load ALL messages for each target conversation ID
  const allThreadMessages: any[] = [];
  const processedMessageIds = new Set<string>();

  for (const conversationId of seedConversationIds) {
    try {
      const threadFilter = `conversationId eq '${conversationId}' and receivedDateTime ge ${eightMonthsAgo.toISOString()}`;
      const threadUrl = `https://graph.microsoft.com/v1.0/users/${userEmail}/messages?$filter=${encodeURIComponent(threadFilter)}&$top=100&$select=${select}`;
      const threadRes: any = await fetch(threadUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (threadRes.ok) {
        const threadData = await threadRes.json();
        for (const m of threadData.value || []) {
          if (!processedMessageIds.has(m.id)) {
            processedMessageIds.add(m.id);
            allThreadMessages.push(m);
          }
        }
      }
    } catch (err: any) {
      console.warn(`[Email Sync] Failed to fetch thread messages for conversation ${conversationId}: ${err.message}`);
    }
  }

  // 4. Process and save all thread messages
  for (const msg of allThreadMessages) {
    const msgDate = new Date(msg.receivedDateTime || msg.sentDateTime);
    if (msgDate < eightMonthsAgo) continue;

    let fullMsg = msg;
    try {
      const fullMsgResponse = await fetch(
        `https://graph.microsoft.com/v1.0/users/${userEmail}/messages/${msg.id}?$select=${select}`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
        }
      );
      if (fullMsgResponse.ok) {
        fullMsg = await fullMsgResponse.json();
      } else {
        const errData = await fullMsgResponse.json();
        console.warn(`[Email Sync] Graph API error fetching message details for ${msg.id}:`, errData?.error?.message);
      }
    } catch (err: any) {
      console.warn(`[Email Sync] Failed to fetch full message details for ${msg.id}: ${err.message}`);
    }

    await processMessageAttachments(accessToken, userEmail, fullMsg);

    const uniqueMsgId = fullMsg.internetMessageId || fullMsg.id;

    results.push({
      updateOne: {
        filter: {
          internetMessageId: uniqueMsgId,
          hospital: hospitalId,
        },
        update: {
          $set: {
            graphId: fullMsg.id,
            internetMessageId: uniqueMsgId,
            sender: fullMsg.sender?.emailAddress,
            from: fullMsg.from?.emailAddress,
            toRecipients:
              fullMsg.toRecipients?.map((r: any) => r.emailAddress) || [],
            ccRecipients:
              fullMsg.ccRecipients?.map((r: any) => r.emailAddress) || [],
            bccRecipients:
              fullMsg.bccRecipients?.map((r: any) => r.emailAddress) || [],
            subject: fullMsg.subject,
            bodyPreview: fullMsg.bodyPreview,
            receivedDateTime: fullMsg.receivedDateTime,
            sentDateTime: fullMsg.sentDateTime,
            hasAttachments: fullMsg.hasAttachments,
            isRead: fullMsg.isRead,
            isDraft: fullMsg.isDraft,
            webLink: fullMsg.webLink,
            conversationId: fullMsg.conversationId,
            importance: fullMsg.importance,
            attachments: fullMsg.attachments,
            hospital: hospitalId,
            crmUser: crmUserId,
            normalizedSubject: normalizeSubject(fullMsg.subject || ""),
            "body.content": fullMsg.body?.content,
            "body.contentType": fullMsg.body?.contentType,
          },
        },
        upsert: true,
      },
    });
  }

  return results;
}

export const syncHospitalEmails = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const { hospitalId } = req.body;



    if (!hospitalId) {
      res.status(400).json({
        success: false,
        message: "hospitalId is required",
      });
      return;
    }

    // Get all CRM users and hospital contacts
    const [users, contacts] = await Promise.all([
      User.find({ email: { $exists: true, $ne: "" } }).select("email _id"),
      Contact.find({
        $or: [{ hospitals: hospitalId }, { hospital: hospitalId }],
      }).select("email"),
    ]);

    const contactEmails = contacts
      .map((c) => c.email)
      .filter(Boolean);

    if (users.length === 0 || contactEmails.length === 0) {
      res.status(200).json({
        success: true,
        message: "No users or contacts found for this hospital",
        totalSynced: 0,
      });
      return;
    }

    const accessToken = await getAppOnlyToken();
    const eightMonthsAgo = new Date(Date.now() - EIGHT_MONTHS_MS);
    const hospitalObjId = new mongoose.Types.ObjectId(hospitalId);
    const select =
      "body,sender,from,toRecipients,ccRecipients,bccRecipients,subject,receivedDateTime,sentDateTime,hasAttachments,isRead,isDraft,webLink,conversationId,importance,bodyPreview,internetMessageId";

    let totalSynced = 0;
    let bulkOps: any[] = [];

    // For each CRM user, search each contact in their mailbox
    for (const user of users) {
      const userEmail = user.email;
      if (!userEmail) continue;

      // Skip users with personal email domains — they won't have M365 mailboxes
      const domain = userEmail.split("@")[1]?.toLowerCase();
      if (domain && ["gmail.com", "outlook.com", "yahoo.com", "hotmail.com", "aol.com", "icloud.com", "gmal.com"].includes(domain)) {
        console.log(`Skipping ${userEmail} — personal email domain`);
        continue;
      }

      for (const contactEmail of contactEmails) {
        const ops = await searchUserMailboxForContact(
          accessToken,
          userEmail,
          contactEmail,
          eightMonthsAgo,
          select,
          user._id,
          hospitalObjId,
        );

        if (ops.length > 0) {
          totalSynced += ops.length;
          bulkOps.push(...ops);
        }

        if (bulkOps.length >= 100) {
          await Email.bulkWrite(bulkOps);
          bulkOps = [];
        }
      }
    }

    if (bulkOps.length > 0) {
      await Email.bulkWrite(bulkOps);
    }

    res.status(200).json({
      success: true,
      message: `Synced ${totalSynced} emails related to hospital contacts across ${users.length} users`,
      totalSynced,
    });
  } catch (error: any) {
    console.error("Sync Hospital Emails Error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Internal Server Error",
    });
  }
};

export const getAttachmentContent = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { userId, messageId, attachmentId } = req.params;

    if (!userId || !messageId || !attachmentId) {
      res.status(400).json({ success: false, message: "Missing parameters" });
      return;
    }

    const accessToken = await getAppOnlyToken();

    const response = await fetch(
      `https://graph.microsoft.com/v1.0/users/${userId}/messages/${messageId}/attachments/${attachmentId}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );

    if (!response.ok) {
      res.status(response.status).json({
        success: false,
        message: "Failed to fetch attachment from Graph API",
      });
      return;
    }

    const attachment = await response.json();

    if (attachment.contentBytes) {
      const buffer = Buffer.from(attachment.contentBytes, "base64");
      res.setHeader(
        "Content-Type",
        attachment.contentType || "application/octet-stream",
      );
      res.setHeader(
        "Content-Disposition",
        `inline; filename="${attachment.name || "attachment"}"`,
      );
      res.status(200).send(buffer);
    } else {
      res
        .status(404)
        .json({ success: false, message: "Attachment content not found" });
    }
  } catch (error: any) {
    console.error("Fetch Attachment Error:", error);
    res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};
