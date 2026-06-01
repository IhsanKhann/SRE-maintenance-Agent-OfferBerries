import { Server as HttpServer } from "http";
import { Server as SocketServer, type Socket } from "socket.io";
import jwt from "jsonwebtoken";
import { cfg, corsOrigins } from "../config.js";
import { logger } from "../utils/logger.js";

let io: SocketServer | null = null;

export function initSRESocket(httpServer: HttpServer): SocketServer {
  io = new SocketServer(httpServer, {
    cors: {
      origin: corsOrigins,
      credentials: true,
    },
    transports: ["websocket", "polling"],
  });

  io.use((socket: Socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) {
      // In dev mode allow unauthenticated connections
      if (cfg.NODE_ENV === "development") return next();
      return next(new Error("Unauthorized: token required"));
    }

    try {
      const payload = jwt.verify(token, cfg.JWT_SECRET) as Record<string, unknown>;
      socket.data.userId = payload.userId ?? payload.id ?? "unknown";
      next();
    } catch {
      next(new Error("Unauthorized: invalid token"));
    }
  });

  io.on("connection", (socket: Socket) => {
    logger.info("[Socket] Dashboard client connected", { userId: socket.data.userId });
    socket.join("sre-admins");

    socket.emit("agent:status", { status: "connected", timestamp: new Date().toISOString() });

    socket.on("request:telemetry", () => {
      socket.emit("agent:log", {
        timestamp: new Date().toISOString(),
        message: "Telemetry refresh requested — next snapshot in ≤15s",
        level: "info",
      });
    });

    socket.on("action:execute", async (data: { toolName: string; params: Record<string, unknown> }) => {
      socket.emit("agent:log", {
        timestamp: new Date().toISOString(),
        message: `[UI] Manual action requested: ${data.toolName}`,
        level: "info",
      });
    });

    socket.on("disconnect", () => {
      logger.info("[Socket] Dashboard client disconnected", { userId: socket.data.userId });
    });
  });

  logger.info("[Socket] SRE Socket.io server initialized");
  return io;
}

export function emitTelemetryUpdate(snapshot: object): void {
  io?.to("sre-admins").emit("telemetry:update", snapshot);
}

export function emitIncidentAlert(incident: object): void {
  io?.to("sre-admins").emit("incident:new", incident);
}

export function emitIncidentClosed(data: object): void {
  io?.to("sre-admins").emit("incident:closed", data);
}

export function emitAgentLog(entry: { timestamp: string; message: string; level: string }): void {
  io?.to("sre-admins").emit("agent:log", entry);
  // Also log to Winston for persistence
  if (entry.level === "error") logger.error(entry.message);
  else if (entry.level === "warn") logger.warn(entry.message);
  else logger.debug(entry.message);
}

export function emitActionResult(result: object): void {
  io?.to("sre-admins").emit("action:result", result);
}

export function emitCodePatch(patch: object): void {
  io?.to("sre-admins").emit("agent:codepatch", patch);
}

export function getConnectedCount(): number {
  return io?.sockets.adapter.rooms.get("sre-admins")?.size ?? 0;
}
