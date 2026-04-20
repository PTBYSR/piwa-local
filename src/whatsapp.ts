/**
 * WhatsApp transport layer (Baileys).
 *
 * Handles connection, pairing, auth persistence, and message routing.
 * Emits inbound owner messages via a callback; exposes sendMessage for replies.
 */

import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
  type WASocket,
  type WAMessageKey,
  type WAMessageContent,
} from "@whiskeysockets/baileys";
import NodeCache from "node-cache";
import pino from "pino";
import * as fs from "fs";
import * as path from "path";

// ---- SILENCE LIBSIGNAL NOISE ----
// Baileys' underlying crypto library (libsignal) aggressively spams console.log/error
// on normal background decryption failures. This breaks the beautiful Terminal UI.
// We intercept and redirect these specific harmless logs to piwa-baileys.log.
const originalConsoleLog = console.log;
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;

function isIgnoredNoise(args: any[]): boolean {
  const str = args.map(a => String(a?.stack || a?.message || a)).join(" ");
  return (
    str.includes("Failed to decrypt message") ||
    str.includes("Session error:") ||
    str.includes("Bad MAC") ||
    str.includes("Closing open session") ||
    str.includes("Closing session:") ||
    str.includes("SessionEntry {")
  );
}

function appendToDebugLog(type: string, args: any[]) {
  try {
    const logFile = path.join(process.cwd(), "piwa-baileys.log");
    const text = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(" ");
    fs.appendFileSync(logFile, `\n[${type}] ${text}`);
  } catch {}
}

console.log = function (...args) {
  if (isIgnoredNoise(args)) return appendToDebugLog("LOG", args);
  originalConsoleLog.apply(console, args);
};
console.error = function (...args) {
  if (isIgnoredNoise(args)) return appendToDebugLog("ERROR", args);
  originalConsoleError.apply(console, args);
};
console.warn = function (...args) {
  if (isIgnoredNoise(args)) return appendToDebugLog("WARN", args);
  originalConsoleWarn.apply(console, args);
};
// ----------------------------------

export interface WhatsAppBridgeOptions {
  authDir: string;
  agentNumber: string;
  ownerNumber: string;
  /** Called when a text message arrives from the owner. */
  onMessage: (text: string, jid: string, pushName: string, bridge: WhatsAppBridge) => void;
}

export interface WhatsAppBridge {
  /** Send a text message to a JID. */
  sendMessage: (jid: string, text: string) => Promise<void>;
  /** Send read receipt for a message key. */
  readMessage: (key: any) => Promise<void>;
  /** Show "typing…" indicator. */
  startTyping: (jid: string) => void;
  /** Clear "typing…" indicator. */
  stopTyping: (jid: string) => void;
  /** Graceful shutdown. */
  close: () => void;
}

export async function createWhatsAppBridge(
  opts: WhatsAppBridgeOptions,
): Promise<WhatsAppBridge> {
  const logFile = path.join(process.cwd(), "piwa-baileys.log");

  // ---- PROACTIVE CLEANUP ----
  // If the developer aborted a previous run while the pairing code was on screen, 
  // Baileys leaves a "half-paired" creds.json file which corrupts future attempts.
  const credsPath = path.join(opts.authDir, "creds.json");
  if (fs.existsSync(credsPath)) {
    try {
      const creds = JSON.parse(fs.readFileSync(credsPath, "utf8"));
      if (!creds.me) {
        console.log("🧹 Cleaning up incomplete pairing state from previous run...");
        fs.rmSync(opts.authDir, { recursive: true, force: true });
      }
    } catch {
      console.log("🧹 Cleaning up corrupted auth file from previous run...");
      fs.rmSync(opts.authDir, { recursive: true, force: true });
    }
  }

  fs.mkdirSync(opts.authDir, { recursive: true });

  const logger = pino(
    { level: "silent" },
    pino.destination({ dest: logFile, sync: false }),
  );

  const msgRetryCounterCache = new NodeCache();

  let globalSock: WASocket | null = null;
  let typingTimers = new Map<string, ReturnType<typeof setInterval>>();

  return new Promise((resolveBridge, rejectBridge) => {
    let isResolved = false;

    function cleanupAndReject(err: Error) {
      if (isResolved) return; // Prevent double rejection if already successfully connected
      
      try { globalSock?.logout(); } catch {}
      try { globalSock?.end(undefined); } catch {}
      
      if (fs.existsSync(opts.authDir)) {
        fs.rmSync(opts.authDir, { recursive: true, force: true });
      }
      
      rejectBridge(err);
    }

    async function start(): Promise<void> {
      const { state, saveCreds } = await useMultiFileAuthState(opts.authDir);

      let version: [number, number, number];
      try {
        const info = await fetchLatestBaileysVersion();
        version = info.version;
        if (!isResolved) console.log(`📦 Using WA Web version: ${version.join(".")}`);
      } catch {
        version = [2, 3000, 1015901307];
      }

      // Let Baileys use its own default browser string to prevent "Couldn't link device"
      let pairingCodeRequested = false;

      const sock = makeWASocket({
        auth: state,
        version,
        printQRInTerminal: false,
        logger,
        connectTimeoutMs: 60000,
        keepAliveIntervalMs: 10000,
        emitOwnEvents: true,
        retryRequestDelayMs: 250,
        syncFullHistory: false,
        msgRetryCounterCache,
        getMessage: async (key: WAMessageKey): Promise<WAMessageContent | undefined> => {
          return undefined; // Usually you'd fetch from a local DB here if you had one.
        },
      });

      globalSock = sock;

      sock.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect } = update;

        // 1. REQUEST PAIRING CODE
        if (
          connection === "connecting" &&
          !sock.authState.creds.registered &&
          !pairingCodeRequested
        ) {
          pairingCodeRequested = true;
          setTimeout(async () => {
            try {
              console.log(`\n📞 Requesting pairing code for ${opts.agentNumber}...`);
              const code = await sock.requestPairingCode(opts.agentNumber);
              console.log(`\n📢 YOUR PAIRING CODE: \x1b[32m${code}\x1b[0m`);
              console.log(`👉 Enter this code on the WhatsApp account for ${opts.agentNumber}`);
              console.log(`⏳ Waiting for you to link...`);
            } catch (err: any) {
              const msg = err?.message?.toLowerCase() || "";
              if (msg.includes("400") || msg.includes("not-authorized")) {
                console.error(`\n❌ ERROR: The Agent number (${opts.agentNumber}) is NOT registered on WhatsApp!`);
                console.error(`Please make sure the number is currently active on a WhatsApp app.`);
                cleanupAndReject(new Error("BAD_AGENT_NUMBER"));
              } else {
                console.error(`\n❌ ERROR: Failed to request pairing code: ${err.message || err}`);
                cleanupAndReject(new Error("TIMEOUT"));
              }
            }
          }, 3000);
        }

        // 2. SUCCESSFULLY CONNECTED
        if (connection === "open") {
          if (!isResolved) {
            console.log("\n🔍 Verifying Owner number...");
            
            try {
              const res = await sock.onWhatsApp(opts.ownerNumber);
              const ownerCheck = res?.[0];
              
              if (!ownerCheck || !ownerCheck.exists) {
                console.error(`\n❌ ERROR: The Owner number (${opts.ownerNumber}) is NOT registered on WhatsApp!`);
                console.error(`The bot cannot be controlled by a non-existent number.`);
                cleanupAndReject(new Error("BAD_OWNER_NUMBER"));
                return;
              }
              
              console.log("✅ Owner verified!");
              console.log("✅ Connected to WhatsApp!\n");
              
              isResolved = true;
              
              const bridgeObject: WhatsAppBridge = {
                sendMessage: async (jid: string, text: string) => {
                  if (globalSock) await globalSock.sendMessage(jid, { text });
                },
                readMessage: async (key: any) => {
                  if (globalSock) await globalSock.readMessages([key]);
                },
                startTyping: (jid: string) => {
                  if (typingTimers.has(jid)) return;
                  globalSock?.sendPresenceUpdate("composing", jid).catch(() => {});
                  const timer = setInterval(() => {
                    globalSock?.sendPresenceUpdate("composing", jid).catch(() => {});
                  }, 10_000);
                  typingTimers.set(jid, timer);
                },
                stopTyping: (jid: string) => {
                  const timer = typingTimers.get(jid);
                  if (timer) {
                    clearInterval(timer);
                    typingTimers.delete(jid);
                  }
                  globalSock?.sendPresenceUpdate("paused", jid).catch(() => {});
                },
                close: () => {
                  for (const timer of typingTimers.values()) clearInterval(timer);
                  typingTimers.clear();
                  try {
                    globalSock?.end(undefined);
                  } catch {}
                },
              };

              // Make bridge available to messages.upsert below
              (globalSock as any).bridgeObject = bridgeObject;

              resolveBridge(bridgeObject);
            } catch (err) {
              console.error("\n❌ ERROR: Failed to verify owner number.", err);
              cleanupAndReject(new Error("BAD_OWNER_NUMBER"));
              return;
            }
          }
        }

        // 3. CONNECTION DROPPED
        if (connection === "close") {
          globalSock = null;
          const err = lastDisconnect?.error as
            | { output?: { statusCode?: number } }
            | undefined;
          const statusCode = err?.output?.statusCode;

          if (
            statusCode === DisconnectReason.loggedOut ||
            statusCode === 401
          ) {
            if (isResolved) {
              console.log("\n👋 Session invalid. Clearing auth...");
              if (fs.existsSync(opts.authDir)) {
                fs.rmSync(opts.authDir, { recursive: true, force: true });
              }
              console.log("✅ Auth cleared. Please restart the app to re-pair.");
              process.exit(0);
            } else {
              cleanupAndReject(new Error("BAD_AGENT_NUMBER"));
            }
          } else if (statusCode === 515 || statusCode === 428) {
            // 515 is DisconnectReason.restartRequired
            // 428 is DisconnectReason.connectionClosed
            // These are normal signals from WhatsApp during the pairing handshake!
            console.log(`\n🔄 WhatsApp requested a stream restart (Normal during pairing, code ${statusCode}). Reconnecting...`);
            start().catch(() => {});
          } else {
            if (isResolved) {
              console.log("\n♻️ Reconnecting to WhatsApp...");
              start().catch(() => {});
            } else {
              // FATAL IF DURING SETUP (e.g. 408 Timeout, 500 Server Error)
              console.error(`\n❌ ERROR: WhatsApp connection dropped during setup. Code: ${statusCode}`);
              cleanupAndReject(new Error("TIMEOUT"));
            }
          }
        }
      });

      sock.ev.on("creds.update", async () => {
        try {
          await saveCreds();
        } catch (e: any) {
          if (e?.code !== "ENOENT") {
            console.error("[Auth] saveCreds failed:", e?.message || e);
          }
        }
      });

      // Replay offline messages
      sock.ev.on("messaging-history.set" as any, (payload: any) => {
        const msgs: any[] = payload?.messages ?? [];
        if (!msgs.length) return;
        for (const msg of msgs) {
          sock.ev.emit("messages.upsert", {
            messages: [msg],
            type: "append",
          } as any);
        }
      });

      // Inbound messages
      sock.ev.on("messages.upsert", async ({ messages }) => {
        for (const msg of messages) {
          if (!msg?.message) continue;
          if (msg.key?.fromMe) continue;

          const jid = msg.key?.remoteJid ?? "";
          const sender = jid.split("@")[0]?.replace(/\D/g, "");
          
          if (sender !== opts.ownerNumber) {
            continue;
          }

          const actualMessage = msg.message?.ephemeralMessage?.message ?? msg.message;
          const text =
            actualMessage?.conversation ??
            actualMessage?.extendedTextMessage?.text ??
            "";
          
          if (!text.trim()) {
            continue;
          }

          const pushName = msg.pushName || "owner";

          // Blue ticks
          try {
            if (msg.key) await sock.readMessages([msg.key]);
          } catch {}

          const bridgeObj = (globalSock as any)?.bridgeObject;
          if (isResolved && bridgeObj) {
            opts.onMessage(text, jid, pushName, bridgeObj);
          }
        }
      });
    }

    start().catch(cleanupAndReject);
  });
}
