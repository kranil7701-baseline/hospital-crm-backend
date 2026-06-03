import mongoose from "mongoose";
import { HospitalData } from "./hospitaldata.js";
import Hospital from "./model/Hospital.ts";
import IDN from "./model/Idn.ts";
import dns from "dns";

if (process.env.NODE_ENV !== "production") {
  dns.setDefaultResultOrder("ipv4first");
  dns.setServers(["8.8.8.8", "8.8.4.4"]);
}

import dotenv from "dotenv";
dotenv.config();

const MONGO_URI = process.env.DATABASE;

async function connectDB() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log("✅ MongoDB Connected");
  } catch (err) {
    console.error("❌ MongoDB Connection Error:", err);
    process.exit(1);
  }
}

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .trim();
}

async function updateHospitalBeds() {
  let updatedCount = 0;
  let blankedCount = 0;
  let notFoundCount = 0;
  let duplicateCount = 0;

  const DEFAULT_IDN_ID = "69fd85dbafc5564f4c500e5e";

  console.log("📥 Loading hospitals...");

  const hospitals = await Hospital.find(
    {},
    {
      _id: 1,
      hospitalName: 1,
      city: 1,
      state: 1,
      idn: 1,
    },
  )
    .populate("idn", "name")
    .lean();

  const hospitalMap = new Map();

  for (const hospital of hospitals) {
    const idnId = hospital.idn?._id?.toString?.() || hospital.idn?.toString?.();

    // If hospital has default/no IDN, don't include IDN in key
    const key =
      idnId === DEFAULT_IDN_ID || !hospital.idn?.name
        ? [
            normalize(hospital.hospitalName),
            normalize(hospital.city),
            normalize(hospital.state),
          ].join("|")
        : [
            normalize(hospital.hospitalName),
            normalize(hospital.city),
            normalize(hospital.state),
            normalize(hospital.idn.name),
          ].join("|");

    if (hospitalMap.has(key)) {
      duplicateCount++;
      console.log(`⚠️ Duplicate Hospital Key: ${hospital.hospitalName}`);
      continue;
    }

    hospitalMap.set(key, hospital);
  }

  const BATCH_SIZE = 30;

  for (let i = 0; i < HospitalData.length; i += BATCH_SIZE) {
    const batch = HospitalData.slice(i, i + BATCH_SIZE);

    const operations = [];

    for (const item of batch) {
      const incomingIdn = item["IDN/Hospital System"];

      let key;

      // No IDN in source data => ignore IDN while matching
      if (!incomingIdn || incomingIdn === "No IDN" || incomingIdn === "null") {
        key = [
          normalize(item["Hospital Name"]),
          normalize(item.City),
          normalize(item.State),
        ].join("|");
      } else {
        key = [
          normalize(item["Hospital Name"]),
          normalize(item.City),
          normalize(item.State),
          normalize(incomingIdn),
        ].join("|");
      }

      const hospital = hospitalMap.get(key);

      if (!hospital) {
        notFoundCount++;

        console.log(
          `❌ Not Found: ${item["Hospital Name"]} | ${item.City} | ${item.State}`,
        );

        continue;
      }

      const beds = item.Beds;

      if (beds === null || beds === undefined || beds === 0 || beds === "") {
        operations.push({
          updateOne: {
            filter: { _id: hospital._id },
            update: {
              $unset: {
                ICUBeds: 1,
              },
            },
          },
        });

        blankedCount++;
      } else {
        operations.push({
          updateOne: {
            filter: { _id: hospital._id },
            update: {
              $set: {
                ICUBeds: Number(beds),
              },
            },
          },
        });

        updatedCount++;
      }
    }

    if (operations.length) {
      const result = await Hospital.bulkWrite(operations);

      console.log(
        `✅ Batch ${Math.floor(i / BATCH_SIZE) + 1} completed | Modified: ${
          result.modifiedCount
        }`,
      );
    }
  }

  console.log("\n========== SUMMARY ==========");
  console.log(`✅ Updated: ${updatedCount}`);
  console.log(`🧹 Cleared: ${blankedCount}`);
  console.log(`❌ Not Found: ${notFoundCount}`);
  console.log(`⚠️ Duplicate Keys: ${duplicateCount}`);
  console.log("=============================");
}

async function main() {
  try {
    await connectDB();

    await updateHospitalBeds();

    console.log("🎉 ICU Beds Migration Completed");
  } catch (error) {
    console.error("❌ Migration Failed:", error);
  } finally {
    await mongoose.connection.close();
    console.log("🔌 MongoDB Connection Closed");
  }
}

main();
