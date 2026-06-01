import { NodeSSH } from "node-ssh";
import { cfg } from "#config";
import { logger } from "#utils/logger";

export async function runRemoteCommand(command: string): Promise<string> {
  if (cfg.NODE_ENV !== "production") {
    const { exec } = await import("child_process");
    const { promisify } = await import("util");
    const execAsync = promisify(exec);
    try {
      const { stdout } = await execAsync(command, { timeout: 8000 });
      return stdout;
    } catch {
      return "";
    }
  }

  // In production, use process.env.PROD_SSH_KEY_PATH so the key written
  // at bootstrap (from PROD_SSH_KEY env var) is picked up at call time.
  const keyPath = process.env.PROD_SSH_KEY_PATH ?? cfg.PROD_SSH_KEY_PATH;

  if (!keyPath || !cfg.PROD_SSH_HOST || cfg.PROD_SSH_HOST === "localhost") {
    throw new Error("SSH not configured — set PROD_SSH_HOST and PROD_SSH_KEY");
  }

  const ssh = new NodeSSH();
  try {
    await ssh.connect({
      host: cfg.PROD_SSH_HOST,
      username: cfg.PROD_SSH_USER,
      privateKeyPath: keyPath,
      readyTimeout: 8000,
    });
    const result = await ssh.execCommand(command, { execOptions: { pty: false } });
    return result.stdout;
  } finally {
    ssh.dispose();
  }
}

export function sshConfigured(): boolean {
  const keyPath = process.env.PROD_SSH_KEY_PATH ?? cfg.PROD_SSH_KEY_PATH;
  return (
    cfg.NODE_ENV === "production" &&
    Boolean(keyPath) &&
    cfg.PROD_SSH_HOST !== "localhost" &&
    Boolean(cfg.PROD_SSH_HOST)
  );
}
