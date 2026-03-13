/** Python bridge — HTTP client for calling the FastAPI CrewAI service. */
import axios, { type AxiosInstance } from "axios";
import { execSync, spawn, type ChildProcess } from "child_process";
import { settings } from "../config/settings.js";
import { log } from "./logger.js";

let httpClient: AxiosInstance | null = null;

function getClient(): AxiosInstance {
  if (!httpClient) {
    httpClient = axios.create({
      baseURL: settings.pythonServiceUrl,
      timeout: 120_000, // CrewAI tasks can take a while
      headers: { "Content-Type": "application/json" },
    });
  }
  return httpClient;
}

/**
 * Call a Python FastAPI endpoint.
 * Used for all CrewAI operations.
 */
export async function callPythonService(
  endpoint: string,
  data?: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const client = getClient();
  try {
    log.info(`→ Python service: POST ${endpoint}`);
    const response = await client.post(endpoint, data || {});
    log.info(`← Python service: ${response.status} OK`);
    return response.data;
  } catch (error: any) {
    const msg = error.response?.data?.detail || error.message;
    log.error(`✗ Python service error: ${msg}`);
    return { success: false, error: msg };
  }
}

/**
 * Spawn a standalone Python script (for OpenClaw cron jobs).
 * Returns the child process for monitoring.
 */
export function spawnPythonScript(scriptName: string): ChildProcess {
  const scriptPath = `scripts/${scriptName}`;
  log.info(`Spawning Python script: ${scriptPath}`);

  const child = spawn("python3", [scriptPath], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env },
  });

  child.stdout?.on("data", (data: Buffer) => {
    log.info(`[python:${scriptName}] ${data.toString().trim()}`);
  });

  child.stderr?.on("data", (data: Buffer) => {
    log.error(`[python:${scriptName}] ${data.toString().trim()}`);
  });

  child.on("close", (code: number | null) => {
    log.info(`[python:${scriptName}] exited with code ${code}`);
  });

  return child;
}

/**
 * Run a Python script synchronously and return output.
 */
export function runPythonScriptSync(scriptName: string): string {
  const scriptPath = `scripts/${scriptName}`;
  try {
    const output = execSync(`python3 ${scriptPath}`, {
      cwd: process.cwd(),
      timeout: 300_000, // 5 min
      encoding: "utf-8",
      env: { ...process.env },
    });
    return output;
  } catch (error: any) {
    log.error(`Python script failed: ${error.message}`);
    throw error;
  }
}

/**
 * Check if the Python FastAPI service is healthy.
 */
export async function checkPythonServiceHealth(): Promise<boolean> {
  try {
    const client = getClient();
    const response = await client.get("/health", { timeout: 5000 });
    return response.status === 200;
  } catch {
    return false;
  }
}
