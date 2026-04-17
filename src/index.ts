/**
 * PIWA — minimal Baileys bridge.
 *
 * Receives WhatsApp messages from OWNER_NUMBER and prints them to the
 * terminal. Connection handling, pairing-code onboarding, and self-cleaning
 * auth are ported from the sneakerheads Baileys integration.
 */

import "dotenv/config";

import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
  type WASocket,
} from "@whiskeysockets/baileys";
import pino from "pino";
import * as fs from "fs";
import * as path from "path";

// -----------------------------------------------------------------------------
// Config
// -----------------------------------------------------------------------------

const WORK_DIR = process.env.WORK_DIR || process.cwd();
const AUTH_DIR = path.join(WORK_DIR, "auth");
const BAILEYS_LOG = path.join(WORK_DIR, "baileys.log");

// The WhatsApp number the bot runs *as*. Used to request the pairing code.
const AGENT_NUMBER = (process.env.AGENT_NUMBER || "").replace(/[^0-9]/g, "");
// The only number whose messages we surface. Others are ignored.
const OWNER_NUMBER = (process.env.OWNER_NUMBER || "").replace(/[^0-9]/g, "");

if (!AGENT_NUMBER) {
  console.error("⚠️  AGENT_NUMBER env var is required (digits only, no +).");
  process.exit(1);
}
if (!OWNER_NUMBER) {
  console.error("⚠️  OWNER_NUMBER env var is required (digits only, no +).");
  process.exit(1);
}

fs.mkdirSync(WORK_DIR, { recursive: true });
fs.mkdirSync(AUTH_DIR, { recursive: true });

const logger = pino(
  { level: "silent" },
  pino.destination({ dest: BAILEYS_LOG, sync: false }),
);

// -----------------------------------------------------------------------------
// Auth helpers
// -----------------------------------------------------------------------------

function clearAuth() {
  if (fs.existsSync(AUTH_DIR)) {
    try {
      fs.rmSync(AUTH_DIR, { recursive: true, force: true });
    } catch {}
  }
}

// -----------------------------------------------------------------------------
// Connection
// -----------------------------------------------------------------------------

let globalSock: WASocket | null = null;

async function start(): Promise<void> {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

  // Fetch latest WA Web version to prevent 405 disconnects.
  let version: [number, number, number];
  try {
    const info = await fetchLatestBaileysVersion();
    version = info.version;
    console.log(`📦 Using WA Web version: ${version.join(".")}`);
  } catch {
    console.warn("⚠️  Could not fetch latest version, using fallback");
    version = [2, 3000, 1015901307];
  }

  // Mac/Safari browser significantly reduces immediate 401 disconnects from
  // WhatsApp's bot detection.
  const browser: [string, string, string] = ["Mac OS", "Safari", "10.15.7"];

  let pairingCodeRequested = false;

  const sock = makeWASocket({
    auth: state,
    version,
    printQRInTerminal: false,
    logger,
    browser,
    connectTimeoutMs: 60000,
    keepAliveIntervalMs: 10000,
    emitOwnEvents: true,
    retryRequestDelayMs: 250,
    syncFullHistory: false,
  });

  globalSock = sock;

  // ---- connection.update ----------------------------------------------------
  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect } = update;

    // First-time pairing: request a code after the WS handshake settles.
    if (
      connection === "connecting" &&
      !sock.authState.creds.registered &&
      !pairingCodeRequested
    ) {
      pairingCodeRequested = true;
      setTimeout(async () => {
        try {
          console.log(
            `\n📞 Requesting pairing code for ${AGENT_NUMBER}... (please wait)`,
          );
          const code = await sock.requestPairingCode(AGENT_NUMBER);
          console.log(`\n📢 YOUR PAIRING CODE: \x1b[32m${code}\x1b[0m`);
          console.log(
            "👉 WhatsApp → Linked Devices → Link a Device → Link with phone number instead",
          );
        } catch (err) {
          console.error("Failed to request pairing code:", err);
          pairingCodeRequested = false;
        }
      }, 3000);
    }

    if (connection === "open") {
      const botJid = sock.user?.id ?? "";
      const botNumber = botJid.split(":")[0];
      console.log("\n✅ Connected to WhatsApp!");
      console.log(`📱 Bot Number: +${botNumber}`);
      console.log(`👤 Listening for messages from OWNER: +${OWNER_NUMBER}`);
      console.log("🖨️  Messages will be printed to this terminal.\n");
    }

    if (connection === "close") {
      globalSock = null;
      const err = lastDisconnect?.error as
        | { output?: { statusCode?: number } }
        | undefined;
      const statusCode = err?.output?.statusCode;

      console.log(`\n🔍 Connection closed: ${statusCode ?? "unknown"}`);

      // Explicit logout (401): wipe auth and exit cleanly so the next start
      // generates a new pairing code. Looping here causes server bans.
      if (
        statusCode === DisconnectReason.loggedOut ||
        statusCode === 401
      ) {
        console.log(
          "👋 Session invalid (Logged out / 401). Clearing auth so the next start re-pairs...",
        );
        clearAuth();
        console.log(
          "✅ Auth cleared. Run `npm start` again to generate a new pairing code.",
        );
        process.exit(0);
      }

      // Everything else (408, 428, 503, stream reset, etc.) is a transient
      // network hiccup — reconnect immediately using existing auth. Do NOT
      // wipe auth here; doing so during the 428 precondition window causes
      // infinite pairing loops.
      console.log("♻️  Reconnecting using existing auth...");
      start().catch((e) => console.error("[Connection] restart failed:", e));
    }
  });

  // ---- creds.update ---------------------------------------------------------
  sock.ev.on("creds.update", async () => {
    try {
      await saveCreds();
    } catch (e: any) {
      if (e?.code !== "ENOENT") {
        console.error("[Auth] saveCreds failed:", e?.message || e);
      }
    }
  });

  // ---- offline history replay ----------------------------------------------
  // When the phone pushes a historical batch, re-emit each as an upsert so
  // messages received while we were offline still flow through the normal
  // handler.
  sock.ev.on("messaging-history.set" as any, (payload: any) => {
    const msgs: any[] = payload?.messages ?? [];
    if (!msgs.length) return;
    console.log(`[History] Replaying ${msgs.length} offline message(s)...`);
    for (const msg of msgs) {
      sock.ev.emit("messages.upsert", {
        messages: [msg],
        type: "append",
      } as any);
    }
  });

  // ---- inbound messages -----------------------------------------------------
  sock.ev.on("messages.upsert", async ({ messages }) => {
    for (const msg of messages) {
      if (!msg?.message) continue;
      if (msg.key?.fromMe) continue;

      const jid = msg.key?.remoteJid ?? "";
      // Owner gate: strip everything after @ and match against OWNER_NUMBER.
      const sender = jid.split("@")[0]?.replace(/\D/g, "");
      if (sender !== OWNER_NUMBER) continue;

      const text =
        msg.message.conversation ??
        msg.message.extendedTextMessage?.text ??
        "";
      if (!text.trim()) continue;

      const pushName = msg.pushName || "owner";
      const ts = new Date().toISOString();
      console.log(`\n📨 [${ts}] ${pushName} (+${sender}):`);
      console.log(`   ${text}`);

      // Give the sender the blue double-tick receipt.
      try {
        if (msg.key) await sock.readMessages([msg.key]);
      } catch {}
    }
  });
}

// -----------------------------------------------------------------------------
// Bootstrap
// -----------------------------------------------------------------------------

start().catch((err) => {
  console.error("Failed to start:", err);
  process.exit(1);
});

// Graceful shutdown — surface Ctrl+C so the terminal doesn't leave a zombie.
process.on("SIGINT", () => {
  console.log("\n👋 Shutting down...");
  try {
    globalSock?.end(undefined);
  } catch {}
  process.exit(0);
});
