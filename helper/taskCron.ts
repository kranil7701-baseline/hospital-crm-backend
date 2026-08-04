import cron from "node-cron";
import Task from "../model/Task.ts";
import TaskAlertLog from "../model/TaskAlertLog.ts";
import { sendPushToUsers } from "../controller/pushNotification.ts";
import { sendGraphEmail } from "./graphEmail.ts";

const isCronJobEnabled = () =>
  String(process.env.ENABLE_CRON_JOB || "").toLowerCase() === "true";

const buildTaskReminderSubject = (taskTitle: string, daysLeft: number) =>
  `Task Reminder: ${taskTitle} due in ${daysLeft} days`;

const buildTaskReminderContent = (
  taskTitle: string,
  description: string,
  hospitalName: string,
  dueDate: Date,
  daysLeft: number,
) => {
  return `
    <p>Hello,</p>
    <p>This is a reminder that the task <strong>${taskTitle}</strong> is due in <strong>${daysLeft} days</strong>.</p>
    <p><strong>Task details:</strong></p>
    <ul>
      <li><strong>Hospital:</strong> ${hospitalName}</li>
      <li><strong>Due date:</strong> ${dueDate.toDateString()}</li>
      <li><strong>Description:</strong> ${description || "No description provided"}</li>
    </ul>
    <p>Please review the task and take any necessary actions.</p>
    <p>View Task: <a href="${process.env.FRONTEND_URL || "#"}">${process.env.FRONTEND_URL || "#"}</a></p>
    <p>Thank you.</p>
  `;
};

const formatDateRange = (baseDate: Date) => {
  const start = new Date(baseDate);
  start.setHours(0, 0, 0, 0);

  const end = new Date(baseDate);
  end.setHours(23, 59, 59, 999);

  return { start, end };
};

export const initTaskCron = () => {
  if (!isCronJobEnabled()) {
    console.log("Cron jobs disabled: skipping task cron initialization.");
    return;
  }

  cron.schedule(
    "0 9 * * *",
    async () => {
      try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const milestones = [
          { label: "5_DAY" as const, days: 5 },
          { label: "2_DAY" as const, days: 2 },
        ];

        for (const milestone of milestones) {
          const targetDate = new Date(today);
          targetDate.setDate(today.getDate() + milestone.days);

          const { start, end } = formatDateRange(targetDate);

          const tasks = await Task.find({
            dueDate: { $gte: start, $lte: end },
            reminders: { $in: ["email", "push"] },
          })
            .populate("user")
            .populate("hospital", "hospitalName");

          for (const task of tasks) {
            const alreadySent = await TaskAlertLog.findOne({
              taskId: task._id,
              milestone: milestone.label,
            });

            if (alreadySent) {
              continue;
            }

            const taskUser: any = task.user;
            if (!taskUser || !taskUser._id) {
              continue;
            }

            const hospitalName =
              (task.hospital as any)?.hospitalName || "Unknown Hospital";
            const daysLeft = milestone.days;
            const subject = buildTaskReminderSubject(task.title, daysLeft);
            const content = buildTaskReminderContent(
              task.title,
              task.description || "",
              hospitalName,
              task.dueDate,
              daysLeft,
            );

            let sentAtLeastOnce = false;

            if (task.reminders.includes("push")) {
              try {
                await sendPushToUsers([taskUser._id.toString()], {
                  title: `${daysLeft}-Day Task Reminder: ${task.title}`,
                  message: `Task is due on ${task.dueDate.toDateString()} for ${hospitalName}.`,
                  url: `${process.env.FRONTEND_URL || "#"}${process.env.FRONTEND_URL ? `/tasks/${task._id}` : ""}`,
                });

                sentAtLeastOnce = true;
              } catch (pushError) {
                console.error("Task push notification failed:", pushError);
              }
            }

            if (task.reminders.includes("email")) {
              if (!taskUser.email) {
                console.warn(
                  `Task ${task._id} has email reminders enabled but assigned user has no email.`,
                );
              } else {
                try {
                  await sendGraphEmail(
                    process.env.MS_GRAPH_FROM_EMAIL || "kmason@rfhealth.com",
                    taskUser.email,
                    subject,
                    content,
                  );

                  sentAtLeastOnce = true;
                } catch (emailError) {
                  console.error("Task email reminder failed:", emailError);
                }
              }
            }

            if (sentAtLeastOnce) {
              await TaskAlertLog.create({
                taskId: task._id,
                userId: taskUser._id,
                milestone: milestone.label,
              });
            }
          }
        }
      } catch (error) {
        console.error("Error in Task Reminder Cron Job:", error);
      }
    },
    { timezone: "America/New_York" },
  );

  // Custom scheduled reminders (runs every 15 minutes)
  cron.schedule(
    "*/15 * * * *",
    async () => {
      try {
        const now = new Date();
        const tasks = await Task.find({
          reminderTime: { $lte: now },
          reminders: { $in: ["email", "push"] },
        })
          .populate("user")
          .populate("hospital", "hospitalName");

        for (const task of tasks) {
          const alreadySent = await TaskAlertLog.findOne({
            taskId: task._id,
            milestone: "CUSTOM",
          });

          if (alreadySent) {
            continue;
          }

          const taskUser: any = task.user;
          if (!taskUser || !taskUser._id) {
            continue;
          }

          const hospitalName =
            (task.hospital as any)?.hospitalName || "Unknown Hospital";
          const subject = `Task Reminder: ${task.title}`;
          const content = `
            <p>Hello,</p>
            <p>This is your scheduled reminder for the task: <strong>${task.title}</strong>.</p>
            <p><strong>Task details:</strong></p>
            <ul>
              <li><strong>Hospital:</strong> ${hospitalName}</li>
              <li><strong>Due Date & Time:</strong> ${task.dueDate.toLocaleString()}</li>
              <li><strong>Description:</strong> ${task.description || "No description provided"}</li>
            </ul>
            <p>Please review the task and take any necessary actions.</p>
            <p>View Task: <a href="${process.env.FRONTEND_URL || "#"}">${process.env.FRONTEND_URL || "#"}</a></p>
            <p>Thank you.</p>
          `;

          let sentAtLeastOnce = false;

          if (task.reminders.includes("push")) {
            try {
              await sendPushToUsers([taskUser._id.toString()], {
                title: `Task Reminder: ${task.title}`,
                message: `Task is due on ${task.dueDate.toLocaleString()} for ${hospitalName}.`,
                url: `${process.env.FRONTEND_URL || "#"}${process.env.FRONTEND_URL ? `/tasks/${task._id}` : ""}`,
              });
              sentAtLeastOnce = true;
            } catch (pushError) {
              console.error("Custom task push notification failed:", pushError);
            }
          }

          if (task.reminders.includes("email")) {
            if (taskUser.email) {
              try {
                await sendGraphEmail(
                  process.env.MS_GRAPH_FROM_EMAIL || "kmason@rfhealth.com",
                  taskUser.email,
                  subject,
                  content,
                );
                sentAtLeastOnce = true;
              } catch (emailError) {
                console.error("Custom task email reminder failed:", emailError);
              }
            }
          }

          if (sentAtLeastOnce) {
            await TaskAlertLog.create({
              taskId: task._id,
              userId: taskUser._id,
              milestone: "CUSTOM",
            });
          }
        }
      } catch (error) {
        console.error("Error in Custom Task Reminder Cron Job:", error);
      }
    },
    { timezone: "America/New_York" }
  );
};
