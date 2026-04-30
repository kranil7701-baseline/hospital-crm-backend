import mongoose from "mongoose";
import dotenv from "dotenv";
import Email from "./model/email.ts";

// Load environment variables from .env
dotenv.config();

export const getOldestEmailDate = async () => {
  try {
    const mongoUri = process.env.DATABASE;
    if (!mongoUri) {
      throw new Error("DATABASE environment variable is missing.");
    }

    // Connect to MongoDB
    await mongoose.connect(mongoUri);
    console.log("✅ Connected to MongoDB");

    // Find the oldest received email
    const oldestReceived = await Email.findOne({ receivedDateTime: { $ne: null } })
      .sort({ receivedDateTime: 1 })
      .select("receivedDateTime")
      .lean();

    // Find the oldest sent email
    const oldestSent = await Email.findOne({ sentDateTime: { $ne: null } })
      .sort({ sentDateTime: 1 })
      .select("sentDateTime")
      .lean();

    let oldestDate: Date | null = null;

    // Compare and find the absolute oldest date
    if (oldestReceived?.receivedDateTime) {
      oldestDate = new Date(oldestReceived.receivedDateTime);
    }

    if (oldestSent?.sentDateTime) {
      const sentDate = new Date(oldestSent.sentDateTime);
      if (!oldestDate || sentDate < oldestDate) {
        oldestDate = sentDate;
      }
    }

    if (oldestDate) {
      console.log(`📌 The absolute oldest email date is: ${oldestDate.toISOString()}`);
    } else {
      console.log("⚠️ No emails found with a valid receivedDateTime or sentDateTime.");
    }

    return oldestDate;

  } catch (error) {
    console.error("❌ Error finding oldest email date:", error);
  } finally {
    // Disconnect to exit the script gracefully
    await mongoose.disconnect();
    console.log("🔌 Disconnected from MongoDB");
  }
};

// Automatically execute if the script is run directly (e.g., via `npx tsx old.ts`)
getOldestEmailDate();
