import cron from "node-cron";
import Deal from "../model/deal.ts";
import DealAlertLog from "../model/DealAlertLog.ts";
import { sendPushToUsers } from "../controller/pushNotification.ts";
import { sendGraphEmail } from "./graphEmail.ts";

export const initDealCron = () => {
  // Run every day at 9:00 AM
  cron.schedule("0 9 * * *", async () => {
    console.log("⏰ Running Deal Closing Date Cron Job (with tracking)...");
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // We look for any deal closing within the next 10 days
      const tenDaysFromNow = new Date(today);
      tenDaysFromNow.setDate(today.getDate() + 10);
      tenDaysFromNow.setHours(23, 59, 59, 999);

      const matchingDeals = await Deal.find({
        "products.expectedCloseDate": { $gte: today, $lte: tenDaysFromNow },
        "products.stage": { $nin: ["Closed Won", "Implemented"] }
      }).populate("user").populate("hospital").populate("products.product");

      console.log(`Found ${matchingDeals.length} deals with deadlines in the next 10 days.`);

      for (const deal of matchingDeals) {
        const user: any = deal.user;
        if (!user || !user.email) continue;

        for (const prod of deal.products) {
          if (!prod.expectedCloseDate) continue;
          if (["Closed Won", "Implemented"].includes(prod.stage || "")) continue;

          const closeDate = new Date(prod.expectedCloseDate);
          closeDate.setHours(0, 0, 0, 0);

          // Calculate days remaining
          const diffTime = closeDate.getTime() - today.getTime();
          const daysLeft = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

          let milestone: '10_DAY' | '5_DAY' | null = null;

          // Determine which milestone we are in
          if (daysLeft > 5 && daysLeft <= 10) {
            milestone = '10_DAY';
          } else if (daysLeft >= 0 && daysLeft <= 5) {
            milestone = '5_DAY';
          }

          if (milestone) {
            // Check if we already sent this specific milestone alert for this product instance
            const alreadySent = await DealAlertLog.findOne({
              dealId: deal._id,
              productInstanceId: (prod as any)._id,
              milestone: milestone
            });

            if (alreadySent) { continue; }

            const hospitalName = (deal.hospital as any)?.hospitalName || "Unknown Hospital";
            const productName = (prod.product as any)?.name || "Product";

            console.log(`🚀 Sending ${milestone} alert for ${hospitalName} (${daysLeft} days left)`);

            // 1. Send Push Notification
            try {
              await sendPushToUsers([user._id.toString()], {
                title: `${milestone === '10_DAY' ? '10' : '5'} Days Left: ${hospitalName}`,
                message: `The expected close date for ${productName} is in ${daysLeft} days.`,
                url: `${process.env.FRONTEND_URL}/hospitals/${deal.hospital._id}`
              });
            } catch (err) {
              console.error("Push failed:", err);
            }

            // 2. Send Email
            const subject = `Testing Lalit: Deal Closing Reminder - ${hospitalName} (${daysLeft} days left)`;
            const content = `
              <p>Testing Lalit</p>
              <p>Hello ${user.name},</p>
              <p>This is a reminder that the deal for <strong>${hospitalName}</strong> is approaching its expected close date.</p>
              <p><strong>Deal Details:</strong></p>
              <ul>
                <li><strong>Product:</strong> ${productName}</li>
                <li><strong>Current Stage:</strong> ${prod.stage}</li>
                <li><strong>Expected Close Date:</strong> ${prod.expectedCloseDate.toDateString()}</li>
                <li><strong>Time Remaining:</strong> ${daysLeft} days</li>
              </ul>
              <p>Please review the deal and take any necessary actions to ensure timely closure.</p>
              <p>View Deal: <a href="${process.env.FRONTEND_URL}/hospitals/${deal.hospital._id}">${process.env.FRONTEND_URL}/hospitals/${deal.hospital._id}</a></p>
            `;

            try {
              await sendGraphEmail("kmason@rfhealth.com", user.email, subject, content);

              // 3. LOG THE SUCCESSFUL SEND to prevent duplicates and allow catch-up
              await DealAlertLog.create({
                dealId: deal._id,
                productInstanceId: (prod as any)._id,
                userId: user._id,
                milestone: milestone
              });

            } catch (err) {
              console.error("Email failed:", err);
            }
          }
        }
      }
    } catch (error) {
      console.error("Error in Deal Cron Job:", error);
    }
  });

  console.log("📅 Deal Reminder Cron Job Initialized (Daily at 9:00 AM with Tracking)");
};