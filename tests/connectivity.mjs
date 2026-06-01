/**
 * Connectivity test — run with: node tests/connectivity.mjs
 * Tests Groq and Gemini API keys from .env
 */
import { readFileSync } from "fs";

// Parse .env manually (no dotenv dependency here)
const env = {};
const envContent = readFileSync(".env", "utf8");
for (const line of envContent.split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eqIdx = trimmed.indexOf("=");
  if (eqIdx === -1) continue;
  const key = trimmed.slice(0, eqIdx).trim();
  const val = trimmed.slice(eqIdx + 1).trim();
  env[key] = val;
}

const GROQ_KEY = env.GROQ_API_KEY;
const GEMINI_KEY = env.GOOGLE_AI_KEY;

console.log("\n═══════════════════════════════════════");
console.log("   SRE Agent — API Connectivity Test    ");
console.log("═══════════════════════════════════════\n");

// ── Test 1: Groq ──────────────────────────────────────────────────────────────
process.stdout.write("[ 1/2 ] Groq (llama-3.3-70b-versatile) ... ");

try {
  const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${GROQ_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: 'Reply with exactly: GROQ_OK' }],
      max_tokens: 10,
    }),
    signal: AbortSignal.timeout(10000),
  });

  if (!groqRes.ok) {
    const err = await groqRes.json().catch(() => ({ error: { message: groqRes.statusText } }));
    console.log(`FAILED (HTTP ${groqRes.status}: ${err?.error?.message ?? "unknown"})`);
  } else {
    const data = await groqRes.json();
    const text = data.choices?.[0]?.message?.content?.trim() ?? "";
    const modelId = data.model ?? "unknown";
    console.log(`OK  — model: ${modelId}`);
    console.log(`         Response: "${text}"`);
    console.log(`         Tokens used: ${data.usage?.total_tokens ?? 0}`);
  }
} catch (err) {
  console.log(`FAILED (${err.message})`);
}

// ── Test 2: Gemini ────────────────────────────────────────────────────────────
process.stdout.write("\n[ 2/2 ] Gemini 2.0 Flash ................. ");

try {
  // Try v1beta endpoint (AI Studio keys use this)
  const geminiRes = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: 'Reply with exactly: GEMINI_OK' }] }],
        generationConfig: { maxOutputTokens: 10 },
      }),
      signal: AbortSignal.timeout(15000),
    }
  );

  if (!geminiRes.ok) {
    const err = await geminiRes.json().catch(() => ({}));
    const msg = err?.error?.message ?? err?.error?.status ?? geminiRes.statusText;
    const status = geminiRes.status;

    if (status === 400 && msg.includes("API_KEY_INVALID")) {
      console.log("FAILED — Key is invalid or wrong format.");
      console.log("\n  ⚠ The key you provided starts with 'AQ.' which looks like");
      console.log("    an OAuth2 token, not an AI Studio API key.");
      console.log("    AI Studio keys start with 'AIza...'");
      console.log("    → Get the right key from: https://aistudio.google.com/apikey");
    } else {
      console.log(`FAILED (HTTP ${status}: ${msg})`);
    }
  } else {
    const data = await geminiRes.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";
    const tokensIn = data?.usageMetadata?.promptTokenCount ?? 0;
    const tokensOut = data?.usageMetadata?.candidatesTokenCount ?? 0;
    console.log(`OK`);
    console.log(`         Response: "${text}"`);
    console.log(`         Tokens — in: ${tokensIn}, out: ${tokensOut}`);
  }
} catch (err) {
  console.log(`FAILED (${err.message})`);
}

console.log("\n═══════════════════════════════════════");
console.log("  ⚠  SECURITY REMINDER:");
console.log("  Both keys were shared in plain text in chat.");
console.log("  Rotate them after this session:");
console.log("  Groq:   console.groq.com → API Keys → Delete & recreate");
console.log("  Gemini: aistudio.google.com/apikey → Delete & recreate");
console.log("═══════════════════════════════════════\n");
