import {
  default as makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  WASocket,
  fetchLatestBaileysVersion,
} from '@whiskeysockets/baileys';
import pino from 'pino';

import * as fs from 'fs';

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Safely clear auth contents without crashing */
function clearAuth() {
  const authDir = process.env.WORK_DIR ? `${process.env.WORK_DIR}/auth` : "auth";
  if (fs.existsSync(authDir)) {
    try {
      fs.rmSync(authDir, { recursive: true, force: true });
    } catch (_) {}
  }
}

// Exported so callers (bridge/index) can send/react. Nulled immediately on
// 'close' so we never send through a zombie socket.
export let currentSock: WASocket | null = null;
let messagesHandler: ((messages: any[]) => Promise<void>) | null = null;

export function setMessagesHandler(handler: (messages: any[]) => Promise<void>) {
  messagesHandler = handler;
}

export async function startWhatsApp(): Promise<void> {
  return new Promise((resolve) => {
    let resolved = false;
    let timerInterval: NodeJS.Timeout | null = null;

    const start = async () => {
      const authDir = process.env.WORK_DIR ? `${process.env.WORK_DIR}/auth` : "auth";
      fs.mkdirSync(authDir, { recursive: true });

      const { state, saveCreds } = await useMultiFileAuthState(authDir);

      let version: [number, number, number];
      try {
        const result = await fetchLatestBaileysVersion();
        version = result.version;
      } catch (_) {
        version = [2, 3000, 1017531287];
      }

      let pairingCodeRequested = false;
      let isSocketAlive = true;

      const sock = makeWASocket({
        auth: state,
        version,
        printQRInTerminal: false,
        logger: pino({ level: 'trace' }, pino.destination('./baileys.log')),
        // Safari/Mac signature is less bot-flagged than Ubuntu/Chrome and
        // mirrors the sneakerheads integration that stays linked reliably.
        browser: ['Mac OS', 'Safari', '10.15.7'],
        markOnlineOnConnect: false,
        connectTimeoutMs: 60000,
        keepAliveIntervalMs: 10000,
        emitOwnEvents: true,
        retryRequestDelayMs: 250,
        syncFullHistory: false,
      });
      currentSock = sock;

      sock.ev.on("messages.upsert", async ({ messages }) => {
        if (messagesHandler) {
          await messagesHandler(messages);
        }
      });

      // Offline replay: when the phone pushes a historical batch via
      // messages.set, re-emit each as an upsert so the bridge processes
      // anything that arrived while we were disconnected.
      sock.ev.on("messaging-history.set" as any, async (payload: any) => {
        try {
          const msgs: any[] = payload?.messages ?? [];
          if (!msgs.length) return;
          console.log(`[Connection] Replaying ${msgs.length} offline message(s)...`);
          for (const msg of msgs) {
            sock.ev.emit("messages.upsert", {
              messages: [msg],
              type: "append",
            } as any);
          }
        } catch (e) {
          console.error("[Connection] Failed offline replay:", e);
        }
      });

      // Swallow ENOENT from saveCreds racing with clearAuth deletion.
      sock.ev.on("creds.update", async () => {
        try {
          await saveCreds();
        } catch (e: any) {
          if (e?.code !== 'ENOENT') {
            // ignore
          }
        }
      });

      sock.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'connecting' && !sock.authState.creds.registered && !pairingCodeRequested) {
          pairingCodeRequested = true;
          setTimeout(async () => {
            if (!isSocketAlive) return;
            try {
              const rawPhoneNumber = process.env.AGENT_NUMBER;
              if (!rawPhoneNumber) throw new Error("Missing AGENT_NUMBER env var.");
              const phoneNumber = rawPhoneNumber.replace(/[^0-9]/g, '');

              const code = await sock.requestPairingCode(phoneNumber);

              if (isSocketAlive) {
                let timeLeft = 60;
                console.log(`\n📌 WhatsApp Web: v${version.join('.')}`);
                console.log(`📞 Requesting code for ${phoneNumber}...`);
                process.stdout.write(`📢 PAIRING CODE: \x1b[32m${code}\x1b[0m (Expires in ${timeLeft}s)\r`);

                if (timerInterval) clearInterval(timerInterval);
                timerInterval = setInterval(() => {
                  timeLeft--;
                  if (timeLeft <= 0) {
                    clearInterval(timerInterval!);
                    process.stdout.write(`\x1b[2K\r⚠️ Pairing code expired. Fetching new code...\n`);
                    isSocketAlive = false;
                    try { sock.end(undefined); } catch {}
                    currentSock = null;
                    clearAuth();
                    start().catch((e) => console.error("[Connection] restart failed:", e));
                  } else if (isSocketAlive && pairingCodeRequested) {
                    process.stdout.write(`\x1b[2K\r📢 PAIRING CODE: \x1b[32m${code}\x1b[0m (Expires in ${timeLeft}s)`);
                  }
                }, 1000);
              }
            } catch (err: any) {
              if (isSocketAlive && err?.message !== 'Connection Closed' && err?.output?.statusCode !== 428) {
                console.log(`⚠️ Failed to request pairing code: ${err?.message || 'Unknown error'}`);
                pairingCodeRequested = false;
              }
            }
          }, 4000);
        }

        if (connection === "close") {
          // CRITICAL: null the exported socket immediately so nothing else
          // tries to send through the dead connection.
          isSocketAlive = false;
          currentSock = null;
          if (timerInterval) clearInterval(timerInterval);
          process.stdout.write('\x1b[2K\r');

          const err = lastDisconnect?.error;
          const statusCode = err && typeof err === 'object' && 'output' in err
            ? (err as { output?: { statusCode?: number } }).output?.statusCode
            : undefined;

          // Hard-exit on terminal states so we don't spin into a 401 ban loop.
          if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
            console.log(`[Connection] ⚠️ Session logged out (${statusCode}). Clearing auth...`);
            clearAuth();
            console.log('[Connection] ✅ Auth cleared. Run `npm start` again to re-pair.');
            process.exit(0);
          }

          if (statusCode === DisconnectReason.connectionReplaced) {
            console.log('[Connection] ⚠️ Connection replaced (another session opened). Exiting.');
            process.exit(0);
          }

          // Anything else — timed out (408), stream reset (515), precondition
          // (428), bad session, generic drops — just restart. No escalating
          // backoff counter; the sneakerheads integration showed that a flat
          // 1s delay + immediate retry keeps the session more alive than
          // clever backoff schemes.
          const reasonName =
            statusCode !== undefined
              ? (DisconnectReason as any)[statusCode] ?? String(statusCode)
              : 'unknown';
          console.log(`[Connection] 🔌 Disconnected (${reasonName}). Reconnecting in 1s...`);
          await delay(1000);
          start().catch((e) => console.error("[Connection] restart failed:", e));
        } else if (connection === "open") {
          isSocketAlive = true;
          if (timerInterval) clearInterval(timerInterval);
          process.stdout.write('\x1b[2K\r');

          if (pairingCodeRequested) {
            console.log("[Connection] ✅ WhatsApp linked — session saved.");
            pairingCodeRequested = false;
          } else {
            console.log("[Connection] 🟢 Online — WhatsApp connection established.");
          }
          if (!resolved) {
            resolved = true;
            resolve();
          }
        }
      });
    };

    start().catch((e) => console.error("[Connection] initial start failed:", e));
  });
}

export async function sendPresence(
  jid: string,
  presence: 'composing' | 'paused' | 'available' | 'unavailable',
): Promise<void> {
  if (!currentSock) {
    console.warn(`[Connection] Dropping presence '${presence}' to ${jid} — no live socket.`);
    return;
  }
  try {
    await currentSock.sendPresenceUpdate(presence, jid);
  } catch (err) {
    console.warn(`[Connection] Failed presence update to ${jid}:`, err);
  }
}

export async function sendMessage(jid: string, text: string): Promise<void> {
  if (!currentSock) {
    // Loud: silent drops are exactly what caused the "bot seems alive but my
    // reply never arrived" confusion. Surface it in the terminal.
    console.error(
      `[Connection] ❌ Cannot send to ${jid}: socket is DEAD. ` +
        `Message dropped (${text.length} chars). Waiting for reconnect...`,
    );
    return;
  }
  try {
    const CHUNK_SIZE = 3500;
    for (let i = 0; i < text.length; i += CHUNK_SIZE) {
      const chunk = text.slice(i, i + CHUNK_SIZE);
      await currentSock.sendMessage(jid, { text: chunk });
    }
  } catch (err) {
    console.error(`[Connection] Failed to send message to ${jid}`, err);
  }
}
