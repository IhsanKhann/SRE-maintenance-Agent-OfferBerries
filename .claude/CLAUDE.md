# SRE Agent — Claude Code Instructions
## Context for AI-assisted work in this directory

---

## WHAT THIS IS

This is the SRE Agent Daemon for OfferBerries ERP. It is a **standalone TypeScript/Node.js
service** that runs on a dedicated Hetzner CX11 server and:

1. Collects telemetry from the production Backend-A (Prometheus, Loki, Docker, BullMQ, Redis)
2. Detects anomalies using static thresholds and dynamic baselines
3. Triages incidents using Groq LLM (fast) and Claude 3.5 Sonnet (code patches)
4. Executes pre-vetted recovery scripts via an allowlist-guarded executor
5. Sends WhatsApp alerts via Twilio and receives commands from the admin
6. Streams all data to a React dashboard via Socket.io
7. Runs scheduled maintenance (backups, log cleanup, analytics reports)

---

## THE PRODUCTION SYSTEM THIS MONITORS (Backend-A)

Located at D:\Backend-offerB (separate repo). Key facts:
- Express 5 + MongoDB Atlas + Redis 7 + BullMQ + Socket.io
- Financial integrity rules: integer paise, session-first writes, atomic $inc, immutable records
- OutboxRelay worker polls MongoDB every 1s, delivers events, 3-attempt retry
- DocumentWorker: BullMQ, generates DOCX files (salary breakups, commission reports)
- Backend-B (marketplace, separate server) sends HMAC-signed webhooks to /api/sync
- Prometheus metrics at :5000/metrics | Loki at :3100 | Grafana dashboards
- Docker Compose: backend, nginx, redis, loki, promtail, prometheus, grafana, cloudflared

---

## DIRECTORY STRUCTURE

```
src/
  index.ts              — Bootstrap: DB → collectors → scheduler → HTTP server
  config.ts             — Zod env validation
  collector/            — Data collection modules (prometheus, loki, docker, bullmq, backendBSync)
  detector/             — Anomaly detection (static thresholds + dynamic baselines)
  incident/             — Incident lifecycle management
  ai/                   — Groq (triage) + Claude (code patches) clients
  executor/             — Allowlist-guarded bash script runner
  analytics/            — Daily aggregation + WhatsApp report builder
  scheduler/            — node-cron job definitions
  comms/                — Socket.io server + Twilio WhatsApp
  api/                  — Express REST endpoints for the dashboard
  db/
    connection.ts       — MongoDB connection
    models/             — Mongoose schemas (Incident, ActionHistory, TelemetrySnapshot, etc.)
  utils/logger.ts       — Winston logger

scripts/                — Pre-vetted bash scripts (ONLY these can be executed)
sre-dashboard/          — React + Vite SPA (deployed to Vercel)
tests/
  unit/                 — Unit tests per module
  integration/          — Integration tests against real MongoDB/Redis
  e2e/                  — Full pipeline simulation tests
```

---

## CRITICAL INVARIANTS (NEVER VIOLATE)

### Security
1. **Script allowlist is the ONLY execution path.** The AI calls a named tool. The tool maps
   to ONE specific script filename in `scripts/`. No arbitrary shell commands. SRE_PARAMS env
   var carries parameters — never interpolated into the command string.
2. **These containers are NEVER in the restart allowlist:** redis, loki, prometheus, grafana.
   Only `backend` / `OfferBerries_backend` and `OfferBerries_nginx` can be restarted.
3. **Claude patches are display-only.** Never write code that auto-applies a Claude patch.
4. **Twilio signature verification** must run on every inbound webhook in production.
5. **WhatsApp sender validation** must check `From === ADMIN_WHATSAPP_NUMBER`.

### Agent Behavior
6. **Groq always calls queryLokiLogs first** before any state-changing action.
7. **Confidence < 0.75** → send WhatsApp for authorization, do NOT act autonomously.
8. **One action per triage loop.** Never chain two state-changing actions.
9. **Autonomous ceiling** (enforced in incidentManager.ts, not in prompts):
   - Auto: OOM-confirmed container restart, BullMQ drain when failed > 50 AND confidence > 0.85
   - Everything else: requires WhatsApp authorization

### Code Standards
10. TypeScript strict mode. All imports use `#alias/*` form from package.json imports map.
11. No relative imports (`../` banned).
12. All async errors caught — never let a collector failure crash the main loop.
13. Collectors run in parallel via `Promise.allSettled` — one failure never blocks others.
14. Tests: mock AI APIs, comms, and filesystem. Unit tests must not hit network.

---

## ENVIRONMENT VARIABLES

Copy `.env.example` to `.env`. Key variables:
- `PROD_BACKEND_METRICS_URL` — Backend-A Prometheus endpoint
- `PROD_REDIS_URL` — Production Redis (for BullMQ inspection)
- `PROD_LOKI_URL` — Loki HTTP API
- `MONGODB_SRE_URI` — SRE Agent's own database (separate from Backend-A)
- `GROQ_API_KEY` — Required for AI triage
- `ANTHROPIC_API_KEY` — Required for Claude code patches
- `TWILIO_*` — Required for WhatsApp alerts
- `JWT_SECRET` — Must match Backend-A's JWT_SECRET exactly

In dev mode (`NODE_ENV=development`):
- Socket.io auth is disabled (any connection accepted)
- WhatsApp messages are logged but not sent
- Docker collector falls back to local `docker` command

---

## RUNNING LOCALLY

```bash
# Install dependencies
npm install

# Start dev server (connects to local Backend-A at localhost:5000)
npm run dev

# Run all tests
npm test

# Run E2E tests (requires MongoDB + Redis running)
npm run test:e2e

# Build for production
npm run build
```

---

## TESTING STANDARDS

- Unit tests: mock ALL external dependencies (axios, ioredis, SSH, AI APIs)
- Jest mock location: before any imports, using jest.mock()
- E2E tests: mock AI APIs and comms; use real MongoDB (test DB, dropped after tests)
- Never use real Groq/Claude/Twilio in any test
- Test coverage target: 80% lines

---

## WHAT TO READ BEFORE MAKING CHANGES

1. This file (CLAUDE.md)
2. `src/config.ts` — understand all env vars
3. The file you're modifying
4. The relevant model in `src/db/models/` if touching data

For AI triage changes: also read `src/ai/toolRegistry.ts` before touching groqClient.ts
For incident flow changes: read `src/incident/incidentManager.ts` completely
