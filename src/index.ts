import * as dotenv from 'dotenv';
dotenv.config();

import * as fs from 'fs';
import * as path from 'path';
import { InteractiveMode } from "@mariozechner/pi-coding-agent";
import { startWhatsApp, sendMessage, setMessagesHandler, currentSock } from "./whatsapp.js";
import { createRuntime } from "./agent.js";
import { createBridge } from "./bridge.js";
import { setup } from "./setup.js";

// File-based debug logger (TUI swallows console output)
const LOG_FILE = path.join(process.cwd(), 'debug.log');
export function dbg(...args: unknown[]) {
  const line = `[${new Date().toISOString()}] ${args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ')}\n`;
  fs.appendFileSync(LOG_FILE, line);
}

// Ensure the dbg function works
dbg("SYSTEM: Startup initialized");


async function main() {
  const modelName = await setup();
  await startWhatsApp();
  
  // 1. Create the runtime instead of a raw session
  const runtime = await createRuntime(modelName);
  
  // 2. Create the WhatsApp bridge (it subscribes to the active session)
  const handleMessage = createBridge(runtime);

  // 3. Initialize the Rich TUI
  const mode = new InteractiveMode(runtime, {
    modelFallbackMessage: undefined,
    initialImages: [],
    initialMessages: [],
  });

  const ownerNumber = process.env.OWNER_NUMBER || "2347088436930";
  const ownerJid = `${ownerNumber}@s.whatsapp.net`;
  const welcomeText = `🤖 *PIWA AI System Online*
  
Model: \`${modelName}\`
Status: Ready for commands.

Available commands:
/new - Start a new session
/model <name> - Switch Ollama model
/compact - Compact context
/session - Show session info
/help - Show this message`;

  // Setup WhatsApp event listener FIRST so we don't miss messages if sendMessage hangs
  dbg("SYSTEM: Setting up messages.upsert listener");
  setMessagesHandler(async (messages) => {
    try {
      dbg(`=== RAW messages.upsert TRIGGERED. Count: ${messages.length} ===`);
      for (const msg of messages) {
        dbg(`Raw msg keys: ${Object.keys(msg || {}).join(',')}. message keys: ${Object.keys(msg.message || {}).join(',')}`);
        
        if (!msg.message) {
            dbg('SKIPPED: msg.message is undefined');
            continue;
        }
        const text = msg.message.conversation
                   ?? msg.message.extendedTextMessage?.text
                   ?? "";
        if (!text.trim()) {
            dbg('SKIPPED: text is empty');
            continue;
        }
        
        const jid = msg.key.remoteJid!;
        
        // File-based debug logging
        dbg(`=== Received message from ${jid} ===`);
        dbg(`Text: "${text}"`);
        dbg(`fromMe: ${msg.key.fromMe}, ownerNumber: ${ownerNumber}, matchesOwner: ${jid.startsWith(ownerNumber)}`);
        
        // Always skip self-messages first (emitOwnEvents echoes our own sends)
        if (msg.key.fromMe) {
            dbg('SKIPPED: fromMe=true');
            continue;
        }

        if (!jid.startsWith(ownerNumber)) {
            dbg('SKIPPED: not from owner');
            continue;
        }

        dbg('PASSED filters — forwarding to bridge...');
        
        // Mark the message as read to give the sender double-blue ticks
        if (currentSock) {
           await currentSock.readMessages([msg.key]);
        }

        // When a message comes in, pass it to the bridge
        // The bridge will call runtime.session.prompt(text)
        // Which instantly updates the TUI screen!
        await handleMessage(text.trim(), jid);
      }
    } catch (err: unknown) {
      dbg('ERROR in messages.upsert handler:', err instanceof Error ? err.stack : String(err));
    }
  });

  try {
    // Run this asynchronously without blocking the TUI startup
    sendMessage(ownerJid, welcomeText).catch(err => {
      dbg("Failed to send welcome message", err);
    });
  } catch (err) {
    // Fails silently if they've never messaged the bot or network is down
  }

  // 4. Start the TUI (this takes over the terminal window and blocks)
  await mode.run();
}

main().catch(err => {
  console.error("Failed to start:", err);
  process.exit(1);
});
