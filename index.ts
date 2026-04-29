import express from "express";
import mongoose from "mongoose";
import dotenv from "dotenv";
import morgan from "morgan";
import cors from "cors";
import cookieParser from "cookie-parser";
import path from "path";

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
import graphRoutes from "./routes/graph.ts";
import documentRoutes from "./routes/document.ts";
import graphCertRoutes from "./routes/graphCertificate.ts";
import graphAppOnlyRoutes from "./routes/graphAppOnly.ts";

// Load environment variables
dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 8000;

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
  }),
);

app.use(cookieParser());
app.use(morgan("dev"));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

// Connect to MongoDB
const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.DATABASE!);
    console.log(`MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error("MongoDB connection error:", error);
    process.exit(1);
  }
};

// Routes
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
// app.use('/api/graph', graphRoutes);
app.use("/api/document", documentRoutes);
// app.use('/api/graph-cert', graphCertRoutes);
app.use("/api/graph-app", graphAppOnlyRoutes);

// Start server
const startServer = async () => {
  console.log(`Attempting to start server on port ${PORT}...`);
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server successfully started and listening on port ${PORT}`);
    connectDB();
  });
};

startServer().catch((err) => {
  console.error("Failed to start server:", err);
});

export default app;
