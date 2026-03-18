/** MongoDB connection via Mongoose. */
import mongoose from "mongoose";
import { settings } from "../config/settings.js";
import { log } from "../utils/logger.js";

let connected = false;

export async function connectDb(): Promise<void> {
  if (connected) return;

  try {
    await mongoose.connect(settings.mongoUri);
    connected = true;
    log.info(`MongoDB connected: ${settings.mongoUri.replace(/\/\/.*@/, "//<credentials>@")}`);
  } catch (err: any) {
    log.error(`MongoDB connection error: ${err.message}`);
    throw err;
  }
}

export async function disconnectDb(): Promise<void> {
  if (!connected) return;
  await mongoose.disconnect();
  connected = false;
}

export { mongoose };
