import { runRemoteCommand, sshConfigured } from "#utils/sshClient";
import { logger } from "#utils/logger";

export interface ContainerLogEntry {
  container: string;
  timestamp: string;
  message: string;
  stream: "stdout" | "stderr";
}

// Containers to watch — matches Backend-A docker-compose services
export const WATCHED_CONTAINERS = [
  "backend",
  "nginx",
  "redis",
  "loki",
  "prometheus",
  "promtail",
  "grafana",
];

export async function fetchContainerLogs(
  containerName: string,
  lines = 100
): Promise<ContainerLogEntry[]> {
  if (!sshConfigured()) {
    logger.debug("[ContainerLogs] SSH not configured — skipping log fetch");
    return [];
  }

  try {
    // --no-log-prefix avoids log driver prefixes, --timestamps gives ISO8601 timestamps
    const raw = await runRemoteCommand(
      `docker logs --tail ${lines} --timestamps ${containerName} 2>&1`
    );

    if (!raw.trim()) return [];

    return raw
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        // Docker timestamps format: 2026-06-01T07:42:00.539Z <message>
        const match = line.match(/^(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\s+(.*)$/);
        if (match) {
          return {
            container: containerName,
            timestamp: match[1],
            message: match[2],
            stream: match[2].startsWith("E ") || match[2].includes("error") ? "stderr" : "stdout",
          } as ContainerLogEntry;
        }
        return {
          container: containerName,
          timestamp: new Date().toISOString(),
          message: line,
          stream: "stdout" as const,
        };
      });
  } catch (err: any) {
    logger.warn("[ContainerLogs] Failed to fetch logs", { container: containerName, error: err.message });
    return [];
  }
}

export async function listRunningContainers(): Promise<string[]> {
  if (!sshConfigured()) return [];
  try {
    const raw = await runRemoteCommand(
      `docker ps --format '{{.Names}}' 2>/dev/null`
    );
    return raw.trim().split("\n").filter(Boolean);
  } catch {
    return [];
  }
}
