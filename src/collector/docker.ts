import { cfg } from "../config.js";
import { logger } from "../utils/logger.js";
import { runRemoteCommand } from "../utils/sshClient.js";
import type { ContainerStat } from "../db/models/TelemetrySnapshot.js";

interface DockerMetrics {
  containers: ContainerStat[];
  totalRestarts: number;
}

async function runSSHCommand(command: string): Promise<string> {
  if (cfg.NODE_ENV !== "production") {
    return runLocalDockerCommand(command);
  }
  return runRemoteCommand(command);
}

// Dev mode: run docker inspect locally (requires Docker Desktop or Docker Engine)
async function runLocalDockerCommand(command: string): Promise<string> {
  const { exec } = await import("child_process");
  const { promisify } = await import("util");
  const execAsync = promisify(exec);
  try {
    const { stdout } = await execAsync(command, { timeout: 8000 });
    return stdout;
  } catch (err: any) {
    return "[]";
  }
}

export async function collectDocker(): Promise<DockerMetrics> {
  try {
    const psOutput = await runSSHCommand(
      `docker ps -a --format '{"name":"{{.Names}}","status":"{{.Status}}","state":"{{.State}}"}'`
    );

    if (!psOutput.trim()) {
      return { containers: [], totalRestarts: 0 };
    }

    const lines = psOutput.trim().split("\n").filter(Boolean);
    const containerNames: string[] = [];

    for (const line of lines) {
      try {
        const obj = JSON.parse(line);
        containerNames.push(obj.name);
      } catch { /* skip malformed */ }
    }

    const containers: ContainerStat[] = [];
    let totalRestarts = 0;

    // Get detailed stats per container
    for (const name of containerNames) {
      try {
        const inspectOut = await runSSHCommand(
          `docker inspect --format '{"status":"{{.State.Status}}","restartCount":{{.RestartCount}}}' ${name}`
        );
        const statsOut = await runSSHCommand(
          `docker stats ${name} --no-stream --format '{"cpu":"{{.CPUPerc}}","mem":"{{.MemUsage}}"}'`
        );

        const inspect = JSON.parse(inspectOut.trim() || "{}");
        const stats = JSON.parse(statsOut.trim() || "{}");

        const cpuStr = (stats.cpu || "0%").replace("%", "");
        const cpuPercent = parseFloat(cpuStr) || 0;

        const memStr = stats.mem || "0B / 0B";
        const memParts = memStr.split("/");
        const memUsageMb = parseMemValue(memParts[0]?.trim() ?? "0");
        const memLimitMb = parseMemValue(memParts[1]?.trim() ?? "0");

        const restartCount = inspect.restartCount ?? 0;
        totalRestarts += restartCount;

        containers.push({
          name,
          status: inspect.status ?? "unknown",
          restartCount,
          cpuPercent,
          memUsageMb,
          memLimitMb,
        });
      } catch { /* container may have stopped mid-collection */ }
    }

    return { containers, totalRestarts };
  } catch (err: any) {
    logger.warn("[Collector:Docker] Collection failed", { error: err.message });
    return { containers: [], totalRestarts: 0 };
  }
}

// Exported for Groq tool handler
export async function getContainerStats(containerName: string): Promise<ContainerStat | null> {
  const metrics = await collectDocker();
  return metrics.containers.find((c) => c.name === containerName) ?? null;
}

function parseMemValue(memStr: string): number {
  const n = parseFloat(memStr);
  if (isNaN(n)) return 0;
  if (memStr.includes("GiB") || memStr.includes("GB")) return n * 1024;
  if (memStr.includes("MiB") || memStr.includes("MB")) return n;
  if (memStr.includes("KiB") || memStr.includes("kB")) return n / 1024;
  return n / (1024 * 1024);
}
