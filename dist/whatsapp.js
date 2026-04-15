import { default as makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, Browsers } from '@whiskeysockets/baileys';
import pino from 'pino';
import * as fs from 'fs';
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
/** Safely clear auth contents without crashing */
function clearAuth() {
    const authDir = process.env.WORK_DIR ? `${process.env.WORK_DIR}/auth` : "auth";
    if (fs.existsSync(authDir)) {
        try {
            fs.rmSync(authDir, { recursive: true, force: true });
        }
        catch (_) { }
    }
}
export async function startWhatsApp() {
    return new Promise((resolve) => {
        let reconnectAttempts = 0;
        let timerInterval = null;
        const start = async () => {
            const authDir = process.env.WORK_DIR ? `${process.env.WORK_DIR}/auth` : "auth";
            // Ensure auth dir
            fs.mkdirSync(authDir, { recursive: true });
            const { state, saveCreds } = await useMultiFileAuthState(authDir);
            let version;
            try {
                const result = await fetchLatestBaileysVersion();
                version = result.version;
            }
            catch (err) {
                version = [2, 3000, 1017531287];
            }
            let pairingCodeRequested = false;
            let isSocketAlive = true; // Flag to prevent orphan logs from dead sockets
            const sock = makeWASocket({
                auth: state,
                version,
                printQRInTerminal: false,
                logger: pino({ level: 'silent' }),
                browser: Browsers.ubuntu('Chrome'),
                markOnlineOnConnect: false,
                connectTimeoutMs: 60000,
                keepAliveIntervalMs: 10000,
                emitOwnEvents: true,
                retryRequestDelayMs: 250,
                syncFullHistory: false
            });
            // Wrap saveCreds to swallow the ENOENT error when we clear auth mid-flight
            sock.ev.on("creds.update", async () => {
                try {
                    await saveCreds();
                }
                catch (e) {
                    if (e.code !== 'ENOENT') {
                        // ignore ENOENT caused by our intentional clearAuth directory deletion
                    }
                }
            });
            sock.ev.on("connection.update", async (update) => {
                const { connection, lastDisconnect } = update;
                if (connection === 'connecting' && !sock.authState.creds.registered && !pairingCodeRequested) {
                    pairingCodeRequested = true;
                    setTimeout(async () => {
                        if (!isSocketAlive)
                            return;
                        try {
                            const rawPhoneNumber = process.env.PHONE_NUMBER;
                            if (!rawPhoneNumber)
                                throw new Error("Missing PHONE_NUMBER env var.");
                            const phoneNumber = rawPhoneNumber.replace(/[^0-9]/g, '');
                            const code = await sock.requestPairingCode(phoneNumber);
                            if (isSocketAlive) {
                                let timeLeft = 60;
                                console.log(`\n📌 WhatsApp Web: v${version.join('.')}`);
                                console.log(`📞 Requesting code for ${phoneNumber}...`);
                                process.stdout.write(`📢 PAIRING CODE: \x1b[32m${code}\x1b[0m (Expires in ${timeLeft}s)\r`);
                                if (timerInterval)
                                    clearInterval(timerInterval);
                                timerInterval = setInterval(() => {
                                    timeLeft--;
                                    if (timeLeft <= 0) {
                                        clearInterval(timerInterval);
                                        process.stdout.write(`\x1b[2K\r⚠️ Pairing code expired. Fetching new code...\n`);
                                        isSocketAlive = false;
                                        sock.end(undefined);
                                        clearAuth();
                                        start();
                                    }
                                    else if (isSocketAlive && pairingCodeRequested) {
                                        process.stdout.write(`\x1b[2K\r📢 PAIRING CODE: \x1b[32m${code}\x1b[0m (Expires in ${timeLeft}s)`);
                                    }
                                }, 1000);
                            }
                        }
                        catch (err) {
                            if (isSocketAlive && err?.message !== 'Connection Closed' && err?.output?.statusCode !== 428) {
                                console.log(`⚠️ Failed to request pairing code: ${err?.message || 'Unknown error'}`);
                                pairingCodeRequested = false;
                            }
                        }
                    }, 4000);
                }
                if (connection === "close") {
                    isSocketAlive = false;
                    if (timerInterval)
                        clearInterval(timerInterval);
                    process.stdout.write('\x1b[2K\r'); // Clear any pending timer lines
                    const err = lastDisconnect?.error;
                    const statusCode = err && typeof err === 'object' && 'output' in err
                        ? err.output?.statusCode
                        : undefined;
                    if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
                        console.log(`⚠️ Session logged out from WhatsApp App (Error ${statusCode}). Clearing auth...`);
                        clearAuth();
                        console.log('✅ Auth cleared! Please run `npm start` again to generate a new pairing code.');
                        process.exit(0);
                    }
                    else {
                        // Suppress noisy generic stream resets (515) and connection drops (408)
                        // Sneakerheads style: only log if it's struggling for an extended period
                        reconnectAttempts++;
                        if (reconnectAttempts > 1 && statusCode !== 515) {
                            const backoff = Math.min(reconnectAttempts * 2000, 15000);
                            console.log(`📡 Network unstable (Code ${statusCode}). Reconnecting in ${backoff / 1000}s...`);
                            await delay(backoff);
                        }
                        else {
                            await delay(1000);
                        }
                        start();
                    }
                }
                else if (connection === "open") {
                    reconnectAttempts = 0;
                    isSocketAlive = true;
                    if (timerInterval)
                        clearInterval(timerInterval);
                    process.stdout.write('\x1b[2K\r'); // Clear timer line
                    if (pairingCodeRequested) {
                        console.log("✅ WhatsApp successfully linked! Session saved.");
                        pairingCodeRequested = false;
                    }
                    else {
                        // Minimal, clean connection success log
                        console.log("🟢 System Online — WhatsApp Connection Established.");
                    }
                    resolve(sock);
                }
            });
        };
        start();
    });
}
export async function sendMessage(sock, jid, text) {
    try {
        const CHUNK_SIZE = 3500;
        for (let i = 0; i < text.length; i += CHUNK_SIZE) {
            const chunk = text.slice(i, i + CHUNK_SIZE);
            await sock.sendMessage(jid, { text: chunk });
        }
    }
    catch (err) {
        console.error(`Failed to send message to ${jid}`, err);
    }
}
