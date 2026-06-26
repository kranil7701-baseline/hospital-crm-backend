import User from "../model/User.ts";
import { sendPushToUsers } from "../controller/pushNotification.ts";
import { sendGraphEmail } from "./graphEmail.ts";

export const handleMentions = async (
  req: any,
  text: string,
  type: string,
  hospitalId?: string
) => {
  if (!text) return;

  try {
    const activeUsers = await User.find({ active: true });
    const mentionedUsers = [];

    for (const user of activeUsers) {
      if (!user.email) continue;
      const emailEscaped = user.email.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      const regex = new RegExp(`(?:^|\\s)@${emailEscaped}(?:\\b|\\s|$)`, 'i');
      if (regex.test(text)) {
        mentionedUsers.push(user);
      }
    }

    if (mentionedUsers.length === 0) return;

    const userIds = mentionedUsers.map((u) => u._id.toString());
    const currentUser = req.user;
    const currentUserName = currentUser?.name || "Someone";
    const currentUserEmail = currentUser?.email;

    const url = hospitalId
      ? `${process.env.FRONTEND_URL}/hospitals/${hospitalId}`
      : `${process.env.FRONTEND_URL}`;
    await sendPushToUsers(userIds, {
      title: `${currentUserName} mentioned you in a ${type}`,
      message: text,
      url: url,
    });

    for (const user of mentionedUsers) {
      if (user.email && currentUserEmail) {
        const subject = `${currentUserName} mentioned you in a ${type}`;
        const emailContent = `
          <p>Hello ${user.name},</p>
          <p>
            <strong>${currentUserName}</strong> mentioned you in a <strong>${type}</strong>:
          </p>
          <blockquote style="border-left: 4px solid #ccc; padding-left: 10px; margin: 10px 0; font-style: italic;">
            ${text}
          </blockquote>
          <p>
            You can view it here:
            <a href="${url}">
              ${url}
            </a>
          </p>
        `;

        sendGraphEmail(currentUserEmail, user.email, subject, emailContent)
          .catch((err) =>
            console.error(`Failed to send email mention to ${user.email}:`, err)
          );
      }
    }
  } catch (err) {
    console.error("Error sending mention notifications:", err);
  }
};
