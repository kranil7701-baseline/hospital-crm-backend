import express from "express";
import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();

import morgan from "morgan";
import cors from "cors";
import cookieParser from "cookie-parser";
import path from "path";

// Routes (unchanged)
import hospitalRoutes from "./routes/hospital.ts";
import idnRoutes from "./routes/idn.ts";
import gpoRoutes from "./routes/gpo.ts";
import pipelineRoutes from "./routes/pipeline.ts";
import contactRoutes from "./routes/contact.ts";
import userRoutes from "./routes/user.ts";
import authRoutes from "./routes/auth.ts";
import productRoutes from "./routes/product.ts";
import dealRoutes from "./routes/deal.ts";
import taskRoutes from "./routes/task.ts";
import noteRoutes from "./routes/notes.ts";
import callLogRoutes from "./routes/callLogs.ts";
import activityRoutes from "./routes/activity.ts";
// import graphRoutes from "./routes/graph";
import documentRoutes from "./routes/document.ts";
// import graphCertRoutes from "./routes/graphCertificate";
import graphAppOnlyRoutes from "./routes/graphAppOnly.ts";
import pushNotificationRoutes from "./routes/pushNotification.ts";
import { setupPush } from "./controller/pushNotification.ts";

const app = express();
setupPush();
const PORT = Number(process.env.PORT) || 8000;

// ================= CORS =================
const allowedOrigins = [
  "https://hospital-crm-frontend.vercel.app",
  "http://localhost:3000",
];

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      } else {
        return callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
  })
);



// ================= MIDDLEWARE =================
app.use(cookieParser());
app.use(morgan("dev"));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

// ================= DB CONNECTION (FIXED FOR VERCEL) =================
const MONGO_URI = process.env.DATABASE as string;

if (!MONGO_URI) {
  throw new Error("DATABASE env variable not defined");
}

// global cache (important for serverless)
let cached = (global as any).mongoose;

if (!cached) {
  cached = (global as any).mongoose = {
    conn: null,
    promise: null,
  };
}

const connectDB = async () => {
  if (cached.conn) return cached.conn;

  if (!cached.promise) {
    mongoose.set("bufferCommands", false);

    cached.promise = mongoose.connect(MONGO_URI).then((mongoose) => {
      console.log("✅ MongoDB Connected");
      return mongoose;
    });
  }

  cached.conn = await cached.promise;
  return cached.conn;
};

// 🔥 Ensure DB is connected before handling ANY request
app.use(async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (err) {
    console.error("DB Connection Failed:", err);
    res.status(500).json({
      success: false,
      message: "Database connection failed",
    });
  }
});

// ================= ROUTES =================
app.get("/", (req, res) => {
  res.json({ message: "CRM Backend API" });
});

app.use("/api/auth", authRoutes);
app.use("/api/hospital", hospitalRoutes);
app.use("/api/idn", idnRoutes);
app.use("/api/gpo", gpoRoutes);
app.use("/api/pipeline", pipelineRoutes);
app.use("/api/contact", contactRoutes);
app.use("/api/user", userRoutes);
app.use("/api/product", productRoutes);
app.use("/api/deal", dealRoutes);
app.use("/api/task", taskRoutes);
app.use("/api/note", noteRoutes);
app.use("/api/call-log", callLogRoutes);
app.use("/api/activity", activityRoutes);
app.use("/api/document", documentRoutes);
app.use("/api/graph-app", graphAppOnlyRoutes);
app.use("/api/push", pushNotificationRoutes);


if (process.env.NODE_ENV !== "production") {
  const startServer = async () => {
    try {
      await connectDB(); // 🔥 connect DB first
      app.listen(PORT, "0.0.0.0", () => {
        console.log(`🚀 Server running on port ${PORT}`);
      });
    } catch (err) {
      console.error("❌ MongoDB Connection Failed:", err);
      process.exit(1);
    }
  };

  startServer();
}

export default app;