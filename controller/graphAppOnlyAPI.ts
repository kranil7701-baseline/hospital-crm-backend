import type { Request, Response } from "express";
import * as msal from "@azure/msal-node";
import type { AuthRequest } from "../middleware/authMiddleware.ts";
import Email from "../model/email.ts";
import fs from "fs";
import path from "path";

const getMsalConfig = () => {
  let privateKey = process.env.MS_GRAPH_PRIVATE_KEY;
  const thumbprint = process.env.MS_GRAPH_CERT_THUMBPRINT;
  const clientId = process.env.MS_GRAPH_CLIENT_ID;
  const tenantId = process.env.MS_GRAPH_TENANT_ID || "common";

  if (!privateKey || !thumbprint || !clientId) {
    throw new Error(
      "Missing MS Graph configuration (Private Key, Thumbprint, or Client ID) in .env",
    );
  }

  // Fix for .env files where newlines are escaped as \n
  if (privateKey && privateKey.includes("\\n")) {
    privateKey = privateKey.replace(/\\n/g, "\n");
  }

  return {
    auth: {
      clientId: clientId,
      authority: `https://login.microsoftonline.com/${tenantId}`,
      clientCertificate: {
        thumbprint: thumbprint,
        privateKey: privateKey,
      },
    },
  };
};

const getMsalClient = () => {
  return new msal.ConfidentialClientApplication(getMsalConfig());
};

const normalizeSubject = (subject: string): string => {
  if (!subject) return "";
  return subject.replace(/^(re|fw|fwd|aw|reply|forward):\s*/i, "").trim();
};

const getAppOnlyToken = async () => {
  const client = getMsalClient();
  const tokenRequest = {
    scopes: ["https://graph.microsoft.com/.default"],
  };

  const response = await client.acquireTokenByClientCredential(tokenRequest);
  if (!response) throw new Error("Failed to acquire App-Only token");
  return response.accessToken;
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

    console.log(
      `Processing ${attachments.length} attachments for message ${message.id}`,
    );

    const cidMatches = bodyContent.match(/cid:[^"'\s>]+/g);
    if (cidMatches) {
      console.log(
        `CIDs found in body for ${message.id}: ${cidMatches.join(", ")}`,
      );
    }

    // 1. Map all available attachments by their CID and Name for quick lookup
    const attachmentMap = new Map<string, any>();
    attachments.forEach((att: any) => {
      console.log(
        `Found attachment: name=${att.name}, contentId=${att.contentId}, hasBytes=${!!att.contentBytes}`,
      );
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
              ? "https://hospital-crm-backend-prp5.onrender.com"
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

      if (!cidMatches && bodyContent.toLowerCase().includes("cid:")) {
        console.log(
          `    * WARNING: 'cid:' string found in body of message ${message.id} but regex failed to match. Check HTML structure.`,
        );
      }

      if (cidMatches) {
        console.log(
          `Analyzing ${cidMatches.length} CIDs for message ${message.id} (${message.subject})`,
        );
        for (const match of cidMatches) {
          const cidPart = match.replace(/cid:<?/i, "").replace(/>?$/i, "");
          let cleanCid = cidPart.replace(/[<>]/g, "").toLowerCase();
          console.log(`  - Checking CID: ${cleanCid}`);

          // Try direct match in current message
          let att = attachmentMap.get(cleanCid);

          // Try match without extension
          if (!att && cleanCid.includes(".")) {
            const baseCid = cleanCid.substring(0, cleanCid.lastIndexOf("."));
            att = attachmentMap.get(baseCid);
            if (att)
              console.log(
                `    * Found match by stripping extension: ${baseCid}`,
              );
          }

          // Try match by stripping everything after @ (common in Outlook)
          if (!att && cleanCid.includes("@")) {
            const prefix = cleanCid.split("@")[0];
            att = attachmentMap.get(prefix);
            if (att)
              console.log(`    * Found match by stripping @ suffix: ${prefix}`);
          }

          // Try stripping 'ii_' prefix (common in Gmail/Outlook threads)
          if (!att && cleanCid.startsWith("ii_")) {
            const stripped = cleanCid.substring(3);
            att = attachmentMap.get(stripped);
            if (att)
              console.log(
                `    * Found match by stripping 'ii_' prefix: ${stripped}`,
              );
          }

          // Try URL decoding
          if (!att) {
            try {
              const decodedCid = decodeURIComponent(cleanCid);
              att = attachmentMap.get(decodedCid);
              if (att)
                console.log(
                  `    * Found match after URL decoding: ${decodedCid}`,
                );
            } catch (e) {}
          }

          // Last resort: search for ANY attachment that contains this CID string in its name or ID
          if (!att) {
            for (const [key, value] of attachmentMap.entries()) {
              if (key.includes(cleanCid) || cleanCid.includes(key)) {
                att = value;
                console.log(`    * Found fuzzy match: ${key}`);
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
                console.log(
                  `    * Found CID ${cleanCid} in current sync batch!`,
                );
                targetUrl = batchAtt.fileUrl;
              }
            }
          }

          // 4. Thread-wide lookup: If still not found, look in the database
          if (!targetUrl && message.conversationId) {
            console.log(
              `    * Searching conversation thread ${message.conversationId} for CID ${cleanCid}...`,
            );
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
                  console.log(
                    `    * Found CID ${cleanCid} in conversation thread!`,
                  );
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
            console.log(
              `    * Final fallback: Global search for CID ${cleanCid}...`,
            );
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
                  console.log(
                    `    * Found CID ${cleanCid} in global database search!`,
                  );
                  targetUrl = globalAtt.fileUrl;
                }
              }
            } catch (err) {
              console.error("    * Global search error:", err);
            }
          }

          if (targetUrl) {
            console.log(`    * SUCCESS: Replaced CID with ${targetUrl}`);
            const escapedCid = cidPart.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            const replaceRegex = new RegExp(`cid:<?${escapedCid}>?`, "gi");
            bodyContent = bodyContent.replace(replaceRegex, targetUrl);
            replacedCount++;
          } else {
            console.log(`    * FAILED: No match found for CID: ${cidPart}`);
            // Check if this CID is in an img src
            const imgSrcRegex = new RegExp(
              `<img[^>]+src=["']cid:<?${cidPart.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}>?["']`,
              "i",
            );
            const tagMatch = bodyContent.match(imgSrcRegex);
            if (tagMatch) {
              console.log(`      Found in tag: ${tagMatch[0]}`);
            }
          }
        }
      }

      // FINAL CATCH-ALL: Scan for any remaining src="cid:..." patterns that might have been missed
      const remainingCids = bodyContent.match(/src=["']cid:([^"'>\s]+)["']/gi);
      if (remainingCids && remainingCids.length > 0) {
        console.log(
          `    * FINAL SCAN: Found ${remainingCids.length} remaining CIDs in src attributes. Attempting last-resort resolution...`,
        );
        // ... previous logic repeats or we can just leave the log to see what they are
      }
    }

    // Update message object
    if (message.body && bodyContent) {
      message.body.content = bodyContent;
    }
    message.attachments = storedAttachments;

    if (replacedCount > 0) {
      console.log(
        `Successfully replaced ${replacedCount} inline images for message: ${message.subject}`,
      );
    }
  } catch (error) {
    console.error(
      `Error processing attachments for message ${message.id}:`,
      error,
    );
  }
};

export const getMailboxMessages0 = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    if (!req.user || !req.user.email) {
      res.status(401).json({
        success: false,
        message: "User not authenticated or email missing",
      });
      return;
    }

    const email = req.user.email;

    // 1. Get Application Token
    const accessToken = await getAppOnlyToken();

    // 2. Call Graph API for the specific user mailbox
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
        message: "Failed to fetch messages from mailbox",
        error: data,
      });
      return;
    }

    const messages = data.value || [];

    // 3. Process Inline Attachments (CIDs) for UI display
    // 3. Process Inline Attachments (CIDs) for UI display
    // Process in chunks to avoid Graph API rate limits but keep it fast
    const chunkSize = 10;
    for (let i = 0; i < messages.length; i += chunkSize) {
      const chunk = messages.slice(i, i + chunkSize);
      await Promise.all(
        chunk.map((msg: any) =>
          processMessageAttachments(accessToken, email, msg),
        ),
      );
    }

    res.status(200).json({
      success: true,
      mailbox: email,
      data: messages,
    });
  } catch (error: any) {
    console.error("App-Only Graph Error:", error);
    res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
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
    const { toEmail, subject, content, ccEmails } = req.body;
    const fromEmail = req.user?.email;

    if (!fromEmail || !toEmail || !subject || !content) {
      res.status(400).json({
        success: false,
        message:
          "Missing required fields (toEmail, subject, content) or user email",
      });
      return;
    }

    // 1. Get Application Token
    const accessToken = await getAppOnlyToken();

    // 2. Prepare the CC Recipients if provided
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

    // 3. Handle Inline Attachments (CIDs)
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
      console.log(
        `Found ${foundCids.size} CIDs in email content. Searching for bytes...`,
      );

      // Optimize: Search for all CIDs at once
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
            contentId: cid, // Use the CID as found in the HTML
            isInline: true,
          });
          console.log(`Attached inline image for CID: ${cid}`);
        }
      }
    }

    // 4. Prepare the Email Payload
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
        attachments: attachments,
      },
      saveToSentItems: "true",
    };

    // 5. Call Graph API to send the mail
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

    const { page = 1, search = "" } = req.query;
    const limit = 10;
    const skip = (Number(page) - 1) * limit;
    const userEmail = req.user.email.toLowerCase();

    // 1. Build Base Match: All emails for this CRM user
    const baseMatch: any = { crmUser: req.user._id };

    // 2. Define the common aggregation stages for threading and filtering
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
          // Search criteria: check if ANY message in the thread matches the search
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
      // Filter: Must have at least one sent message and match search
      { $match: { hasSent: true, searchMatch: true } },
    ];

    // 3. Execute List Query
    const emails = await Email.aggregate([
      ...threadingStages,
      { $replaceRoot: { newRoot: "$latestDoc" } },
      { $sort: { receivedDateTime: -1 } },
      { $skip: skip },
      { $limit: limit },
    ]);

    // 4. Execute Count Query
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

    const { page = 1, search = "" } = req.query;
    const limit = 10;
    const skip = (Number(page) - 1) * limit;
    const userEmail = req.user.email.toLowerCase();

    // 1. Build Base Match: All emails for this CRM user
    const baseMatch: any = { crmUser: req.user._id };

    // 2. Define the common aggregation stages for threading and filtering
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
          // Search criteria: check if ANY message in the thread matches the search
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
      // Filter: Must have at least one received message and match search
      { $match: { hasReceived: true, searchMatch: true } },
    ];

    // 3. Execute List Query
    const emails = await Email.aggregate([
      ...threadingStages,
      { $replaceRoot: { newRoot: "$latestDoc" } },
      { $sort: { receivedDateTime: -1 } },
      { $skip: skip },
      { $limit: limit },
    ]);

    // 4. Execute Count Query
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

export const syncMailboxMessagesByDate = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    if (!req.user || !req.user.email) {
      res.status(401).json({
        success: false,
        message: "User not authenticated or email missing",
      });
      return;
    }

    const email = req.user.email;

    // 1. Get Application Token
    const accessToken = await getAppOnlyToken();

    // 2. Find the latest email date in our DB to perform an incremental sync
    const lastEmail = await Email.findOne({ crmUser: req.user._id }).sort({
      receivedDateTime: -1,
    });

    let filter = "";
    if (lastEmail && lastEmail.receivedDateTime) {
      const lastDate = lastEmail.receivedDateTime.toISOString();
      // Filter for emails received AFTER or AT the last sync time
      filter = `&$filter=receivedDateTime ge ${lastDate}`;
    }

    // 3. Call Graph API for messages (Incremental Sync)
    const select =
      "body,sender,from,toRecipients,ccRecipients,bccRecipients,subject,receivedDateTime,sentDateTime,hasAttachments,isRead,isDraft,webLink,conversationId,importance,bodyPreview";
    const graphUrl = `https://graph.microsoft.com/v1.0/users/${email}/messages?$top=500&$orderby=receivedDateTime desc&$select=${select}${filter}`;

    const graphResponse = await fetch(graphUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    const data = await graphResponse.json();

    if (!graphResponse.ok) {
      res.status(graphResponse.status).json({
        success: false,
        message: "Failed to fetch messages from Microsoft Graph",
        error: data,
      });
      return;
    }

    const messages = data.value || [];

    if (messages.length === 0) {
      res.status(200).json({
        success: true,
        message: `No new messages found for ${email} (Incremental)`,
        count: 0,
      });
      return;
    }

    // 4. Process Inline Attachments (CIDs)
    // Process in chunks to avoid Graph API rate limits but keep it fast
    (global as any).currentSyncBatch = messages;
    const chunkSize = 10;
    for (let i = 0; i < messages.length; i += chunkSize) {
      const chunk = messages.slice(i, i + chunkSize);
      await Promise.all(
        chunk.map((msg: any) =>
          processMessageAttachments(accessToken, email, msg),
        ),
      );
    }
    delete (global as any).currentSyncBatch;

    // 5. Prepare Bulk Operations to avoid duplicates using graphId
    const ops = messages.map((msg: any) => ({
      updateOne: {
        filter: { graphId: msg.id },
        update: {
          $set: {
            graphId: msg.id,
            sender: msg.sender?.emailAddress,
            from: msg.from?.emailAddress,
            toRecipients:
              msg.toRecipients?.map((r: any) => r.emailAddress) || [],
            ccRecipients:
              msg.ccRecipients?.map((r: any) => r.emailAddress) || [],
            bccRecipients:
              msg.bccRecipients?.map((r: any) => r.emailAddress) || [],
            subject: msg.subject,
            bodyPreview: msg.bodyPreview,
            receivedDateTime: msg.receivedDateTime,
            sentDateTime: msg.sentDateTime,
            hasAttachments: msg.hasAttachments,
            isRead: msg.isRead,
            isDraft: msg.isDraft,
            webLink: msg.webLink,
            conversationId: msg.conversationId,
            importance: msg.importance,
            attachments: msg.attachments,
            crmUser: req.user?._id,
            normalizedSubject: normalizeSubject(msg.subject),
            "body.content": msg.body?.content,
            "body.contentType": msg.body?.contentType,
          },
        },
        upsert: true,
      },
    }));

    // 5. Execute Bulk Write
    const result = await Email.bulkWrite(ops);

    res.status(200).json({
      success: true,
      message: `Successfully synced messages for ${email} (Incremental)`,
      stats: {
        totalSynced: messages.length,
        newlyAdded: result.upsertedCount,
        updated: result.modifiedCount,
      },
    });
  } catch (error: any) {
    console.error("Incremental Sync Mailbox Error:", error);
    res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

export const syncMailboxMessages = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    if (!req.user || !req.user.email) {
      res.status(401).json({
        success: false,
        message: "User not authenticated or email missing",
      });
      return;
    }

    const email = req.user.email;

    // 1. Get Application Token
    const accessToken = await getAppOnlyToken();

    // 2. Call Graph API for messages
    const select =
      "body,sender,from,toRecipients,ccRecipients,bccRecipients,subject,receivedDateTime,sentDateTime,hasAttachments,isRead,isDraft,webLink,conversationId,importance,bodyPreview";
    const graphResponse = await fetch(
      `https://graph.microsoft.com/v1.0/users/${email}/messages?$top=500&$select=${select}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );

    const data = await graphResponse.json();

    if (!graphResponse.ok) {
      res.status(graphResponse.status).json({
        success: false,
        message: "Failed to fetch messages from Microsoft Graph",
        error: data,
      });
      return;
    }

    const messages = data.value || [];

    if (messages.length === 0) {
      res.status(200).json({
        success: true,
        message: `No new messages found for ${email}`,
        count: 0,
      });
      return;
    }

    // 3. Process Inline Attachments (CIDs)
    // 3. Process Inline Attachments (CIDs)
    // Process in chunks to avoid Graph API rate limits but keep it fast
    (global as any).currentSyncBatch = messages;
    const chunkSize = 10;
    for (let i = 0; i < messages.length; i += chunkSize) {
      const chunk = messages.slice(i, i + chunkSize);
      await Promise.all(
        chunk.map((msg: any) =>
          processMessageAttachments(accessToken, email, msg),
        ),
      );
    }
    delete (global as any).currentSyncBatch;

    // 4. Prepare Bulk Operations to avoid duplicates using graphId
    const ops = messages.map((msg: any) => ({
      updateOne: {
        filter: { graphId: msg.id },
        update: {
          $set: {
            graphId: msg.id,
            sender: msg.sender?.emailAddress,
            from: msg.from?.emailAddress,
            toRecipients:
              msg.toRecipients?.map((r: any) => r.emailAddress) || [],
            ccRecipients:
              msg.ccRecipients?.map((r: any) => r.emailAddress) || [],
            bccRecipients:
              msg.bccRecipients?.map((r: any) => r.emailAddress) || [],
            subject: msg.subject,
            bodyPreview: msg.bodyPreview,
            receivedDateTime: msg.receivedDateTime,
            sentDateTime: msg.sentDateTime,
            hasAttachments: msg.hasAttachments,
            isRead: msg.isRead,
            isDraft: msg.isDraft,
            webLink: msg.webLink,
            conversationId: msg.conversationId,
            importance: msg.importance,
            attachments: msg.attachments,
            crmUser: req.user?._id,
            "body.content": msg.body?.content,
            "body.contentType": msg.body?.contentType,
          },
        },
        upsert: true,
      },
    }));

    // 4. Execute Bulk Write
    const result = await Email.bulkWrite(ops);

    res.status(200).json({
      success: true,
      message: `Successfully synced messages for ${email}`,
      stats: {
        totalSynced: messages.length,
        newlyAdded: result.upsertedCount,
        updated: result.modifiedCount,
      },
    });
  } catch (error: any) {
    console.error("Sync Mailbox Error:", error);
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

    // 1. Get Application Token
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

    // 3. Call Graph API to reply
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

    // Microsoft Graph reply action returns 202 Accepted on success with no body
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
        `attachment; filename="${attachment.name || "attachment"}"`,
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
