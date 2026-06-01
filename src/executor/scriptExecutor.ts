import { exec } from "child_process";
import { promisify } from "util";
import path from "path";
import { fileURLToPath } from "url";
import { logger } from "../utils/logger.js";
import { emitAgentLog } from "../comms/socketServer.js";

const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS_DIR = path.resolve(__dirname, "../../scripts");

// ALLOWLIST: The AI calls a named tool → maps to EXACTLY ONE script filename.
// No arbitrary commands. No path traversal. SRE_PARAMS JSON env var carries all params.
const SCRIPT_MAP: Record<string, string> = {
  clearBullMQDeadLetters: "clearBullMQDeadLetters.sh",
  gracefulRestartContainer: "gracefulRestartContainer.sh",
  flushRedisRateLimitKeys: "flushRedisRateLimit.sh",
  scaleDocumentWorker: "scaleDocumentWorker.sh",
  reloadNginx: "nginxReload.sh",
  triggerBackup: "dailyMongoBackup.sh",
  zeroDowntimeDeploy: "zeroDowntimeDeploy.sh",
  autoRollback: "autoRollback.sh",
  dockerLogCleanup: "dockerLogCleanup.sh",
  diskSpaceCleanup: "diskSpaceCleanup.sh",
  dailyMongoBackup: "dailyMongoBackup.sh",
  redisBackup: "redisBackup.sh",
  verifyBackup: "verifyBackup.sh",
};

// In-process tools — handled by collector/comms modules, no script needed
const IN_PROCESS_TOOLS = new Set([
  "queryLokiLogs",
  "getContainerStats",
  "getQueueState",
  "sendHumanAlert",
]);

export interface ScriptResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
}

export async function executeScript(
  toolName: string,
  params: Record<string, unknown>
): Promise<ScriptResult> {
  if (IN_PROCESS_TOOLS.has(toolName)) {
    return { stdout: "Handled in-process", stderr: "", exitCode: 0, durationMs: 0 };
  }

  const scriptFile = SCRIPT_MAP[toolName];
  if (!scriptFile) {
    const msg = `[Executor] REJECTED: "${toolName}" not in allowlist`;
    logger.error(msg);
    emitAgentLog({ timestamp: new Date().toISOString(), message: msg, level: "error" });
    return { stdout: "", stderr: msg, exitCode: 1, durationMs: 0 };
  }

  const scriptPath = path.join(SCRIPTS_DIR, scriptFile);
  const startMs = Date.now();

  emitAgentLog({
    timestamp: new Date().toISOString(),
    message: `[Executor] Running: ${scriptFile} params=${JSON.stringify(params)}`,
    level: "info",
  });

  try {
    const { stdout, stderr } = await execAsync(`bash "${scriptPath}"`, {
      // Pass params as JSON env var — NEVER interpolate into command string
      env: { ...process.env, SRE_PARAMS: JSON.stringify(params) },
      timeout: 60_000,
      cwd: SCRIPTS_DIR,
    });

    const durationMs = Date.now() - startMs;
    emitAgentLog({
      timestamp: new Date().toISOString(),
      message: `[Executor] ${scriptFile} completed in ${durationMs}ms`,
      level: "info",
    });

    return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode: 0, durationMs };
  } catch (err: any) {
    const durationMs = Date.now() - startMs;
    emitAgentLog({
      timestamp: new Date().toISOString(),
      message: `[Executor] ${scriptFile} FAILED (exit ${err.code ?? 1}): ${err.stderr?.slice(0, 200)}`,
      level: "error",
    });

    return {
      stdout: err.stdout?.trim() ?? "",
      stderr: err.stderr?.trim() ?? err.message,
      exitCode: err.code ?? 1,
      durationMs,
    };
  }
}
