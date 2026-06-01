# SRE Agent — What You Need to Buy & Configure

## BEFORE RUNNING IN PRODUCTION — Action Required

---

### 1. Hetzner CX11 (€4/month) — REQUIRED
**What**: New VPS on Hetzner Cloud (same datacenter as your production server)
**Why**: The SRE daemon needs to run 24/7, access Docker, and use SSH to the prod server

**Steps**:
1. Login to console.hetzner.com
2. Create new CX11 (Arm64, Falkenstein datacenter → same as your prod server)
3. Add the SRE CX11 to the same Hetzner Private Network as your production server
4. SSH in and install Docker + Docker Compose
5. Clone this repo and set up .env

**Cost**: €4/month (~PKR 1,200)

---

### 2. Groq API Key — REQUIRED for AI triage
**What**: Fast LLM API for incident triage (llama-3.1-70b)
**Why**: First responder for anomalies — reads Loki logs, decides action

**Steps**:
1. Go to console.groq.com
2. Create account → API Keys → Create Key
3. Add to .env: `GROQ_API_KEY=gsk_...`

**Cost**: ~$3–5/month (~PKR 850–1,400) for ~5,000 triage calls

---

### 3. Anthropic API Key — REQUIRED for code patches
**What**: Claude 3.5 Sonnet for generating code patches from stack traces
**Why**: Deep code understanding — reads your actual source files

**Steps**:
1. Go to console.anthropic.com
2. Create API key
3. Add to .env: `ANTHROPIC_API_KEY=sk-ant-...`

**Cost**: ~$5–15/month (~PKR 1,400–4,200) for 10–30 complex escalations

---

### 4. Twilio WhatsApp Business — REQUIRED for phone alerts
**What**: WhatsApp API to send/receive incident alerts on your phone
**Why**: Core interface — you authorize/deny actions via WhatsApp reply

**Steps**:
1. Go to console.twilio.com
2. Create account → Messaging → WhatsApp Sandbox (for testing)
   - Or upgrade to WhatsApp Business for production
3. Get: Account SID, Auth Token, WhatsApp number
4. Set webhook URL in Twilio console:
   `https://sre-api.offerberries.com/api/whatsapp/webhook`
5. Send "join <sandbox-word>" from your phone to activate sandbox

**Add to .env**:
```
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
ADMIN_WHATSAPP_NUMBER=whatsapp:+923001234567   # YOUR number
TWILIO_WHATSAPP_FROM=whatsapp:+14155238886     # Twilio sandbox number
SRE_PUBLIC_URL=https://sre-api.offerberries.com
```

**Cost**: ~$1–3/month (~PKR 280–840) for ~300 messages

---

### 5. Hetzner Object Storage — REQUIRED for backups
**What**: S3-compatible object storage for daily MongoDB backups
**Why**: 30-day retention, verified weekly — your disaster recovery

**Steps**:
1. In Hetzner Console → Object Storage → Create Bucket "offerberries-backups"
2. Create Access Key
3. Add to .env:
```
HETZNER_S3_ENDPOINT=https://fsn1.your-objectstorage.com
HETZNER_S3_ACCESS_KEY=...
HETZNER_S3_SECRET_KEY=...
BACKUP_S3_BUCKET=offerberries-backups
```

**Cost**: ~$1/month (~PKR 280) for ~100 GB

---

### 6. Production Server Setup (One-time, 10 minutes)
SSH into your production Hetzner server and run:

```bash
# Create restricted deploy user for SRE daemon
sudo useradd -m -s /bin/bash deploy
sudo mkdir -p /home/deploy/.ssh

# On the SRE CX11: generate SSH key
ssh-keygen -t ed25519 -f ~/.ssh/sre_deploy_key -N ""
cat ~/.ssh/sre_deploy_key.pub

# Back on production server: add SRE's public key
echo "paste_sre_public_key_here" | sudo tee -a /home/deploy/.ssh/authorized_keys
sudo chmod 700 /home/deploy/.ssh
sudo chmod 600 /home/deploy/.ssh/authorized_keys

# Grant deploy user ONLY these specific docker commands
sudo tee /etc/sudoers.d/sre-deploy << 'EOF'
deploy ALL=(ALL) NOPASSWD: /usr/bin/docker restart OfferBerries_backend
deploy ALL=(ALL) NOPASSWD: /usr/bin/docker restart OfferBerries_nginx
deploy ALL=(ALL) NOPASSWD: /usr/bin/docker inspect *
deploy ALL=(ALL) NOPASSWD: /usr/bin/docker ps *
deploy ALL=(ALL) NOPASSWD: /usr/bin/docker stats *
deploy ALL=(ALL) NOPASSWD: /usr/bin/docker exec OfferBerries_nginx *
EOF
```

Copy the SRE private key to `D:\SRE-Agent\ssh_deploy_key` for the docker volume mount.

---

### 7. Cloudflare Tunnel — Add SRE API route
In your existing Cloudflare Tunnel config (on the production server), add:

```json
{
  "ingress": [
    {
      "hostname": "sre-api.offerberries.com",
      "service": "http://sre-agent:3500",
      "originRequest": { "noTLSVerify": false }
    }
  ]
}
```

Or if the SRE daemon runs on the new CX11 with its own cloudflared:
- Create a separate tunnel from the CX11
- Route `sre-api.offerberries.com` → `http://localhost:3500`

---

### 8. UptimeRobot (Free) — External watchdog
**What**: Independent uptime monitoring (doesn't depend on your SRE agent being up)
**Why**: If the SRE agent itself crashes, you still get alerts

**Steps**:
1. uptimerobot.com → Free account
2. Add monitor: `https://api.offerberries.com/api/health` every 5 minutes
3. Add monitor: `https://sre-api.offerberries.com/ping` every 5 minutes
4. Alert to your email + phone number

**Cost**: Free

---

### 9. Vercel Deployment — SRE Dashboard
**What**: Host the React dashboard at `sre.offerberries.com`

**Steps**:
1. Push `D:\SRE-Agent\sre-dashboard` to a GitHub repo
2. Connect to Vercel
3. Set env var: `VITE_SRE_URL=https://sre-api.offerberries.com`
4. Add custom domain: `sre.offerberries.com` → Vercel CNAME

**Cost**: Free (Vercel hobby plan)

---

## TOTAL MONTHLY COST ESTIMATE

| Item | PKR/month |
|---|---|
| Hetzner CX11 | ~1,200 |
| MongoDB Atlas M0 (SRE DB) | Free |
| Groq API | ~1,100 |
| Anthropic Claude | ~2,800 |
| Twilio WhatsApp | ~560 |
| Hetzner Object Storage | ~280 |
| UptimeRobot | Free |
| Vercel Dashboard | Free |
| **TOTAL** | **~5,940** |

vs. PKR 40,000/month for a junior DevOps engineer.

---

## ENVIRONMENT SETUP STEPS

```bash
# On the SRE CX11:
git clone https://github.com/IhsanKhann/sre-agent.git  # (after you push)
cd sre-agent
cp .env.example .env
nano .env   # Fill in all values from this guide

# Set Prod connection (using Hetzner private network internal IPs):
# PROD_BACKEND_METRICS_URL=http://10.0.0.1:5000/metrics
# PROD_LOKI_URL=http://10.0.0.1:3100
# PROD_REDIS_URL=redis://10.0.0.1:6379
# PROD_SSH_HOST=10.0.0.1
# JWT_SECRET=(copy from D:\Backend-offerB\backend\.env.production)

# Place SSH key:
cp ~/.ssh/sre_deploy_key ./ssh_deploy_key

# Start the daemon:
docker compose up -d

# Watch logs:
docker logs -f sre_agent

# Verify it's working:
curl http://localhost:3500/ping   # should return "ok"
curl http://localhost:3500/api/health   # should return JSON with status: ok
```
