import crypto from "crypto";
import axios, { type AxiosInstance } from "axios";
import type { Request, Response, NextFunction } from "express";
import { cfg } from "#config";
import { logger } from "#utils/logger";

/**
 * Inbound middleware — validates requests from Backend-A.
 * Checks Authorization: Bearer <SRE_INTERNAL_KEY> or x-internal-token header.
 * Uses timing-safe comparison to prevent timing attacks.
 */
export function b2bAuthMiddleware(req: Request, res: Response, next: NextFunction): void {
  const authHeader = (req.headers["authorization"] as string) ?? "";
  const tokenFromBearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  const tokenFromHeader = (req.headers["x-internal-token"] as string) ?? null;
  const token = tokenFromBearer ?? tokenFromHeader;

  const expected = cfg.SRE_INTERNAL_KEY;

  if (!expected) {
    logger.error("[B2BAuth] SRE_INTERNAL_KEY is not set — blocking inbound B2B call");
    res.status(503).json({ success: false, message: "SRE agent misconfigured" });
    return;
  }

  if (!token) {
    res.status(401).json({ success: false, message: "Unauthorized" });
    return;
  }

  try {
    const a = Buffer.from(token);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      res.status(401).json({ success: false, message: "Unauthorized" });
      return;
    }
  } catch {
    res.status(401).json({ success: false, message: "Unauthorized" });
    return;
  }

  next();
}

let _backendAClient: AxiosInstance | null = null;

/**
 * Outbound client — adds Authorization: Bearer <SRE_INTERNAL_KEY> to every request.
 * Used when the SRE agent calls Backend-A's internal endpoints.
 * Lazily created and reused.
 */
export function getBackendAClient(): AxiosInstance {
  if (_backendAClient) return _backendAClient;

  const baseURL = cfg.PROD_BACKEND_HEALTH_URL.replace(/\/api\/health$/, "");

  _backendAClient = axios.create({ baseURL, timeout: 8000 });

  _backendAClient.interceptors.request.use((config) => {
    const key = cfg.SRE_INTERNAL_KEY;
    if (!key) throw new Error("[B2BAuth] SRE_INTERNAL_KEY not set — cannot call Backend-A");
    config.headers = config.headers ?? {};
    config.headers["Authorization"] = `Bearer ${key}`;
    config.headers["x-source"] = "sre-agent";
    return config;
  });

  _backendAClient.interceptors.response.use(
    (r) => r,
    (err) => {
      logger.warn("[B2BAuth] Backend-A call failed", {
        url: err.config?.url,
        status: err.response?.status,
        message: err.message,
      });
      return Promise.reject(err);
    }
  );

  return _backendAClient;
}
