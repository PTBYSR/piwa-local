import * as dotenv from 'dotenv';
dotenv.config();
import { InteractiveMode } from "@mariozechner/pi-coding-agent";
import { startWhatsApp, sendMessage } from "./whatsapp.js";
import { createRuntime } from "./agent.js";
import { createBridge } from "./bridge.js";
import { setup } from "./setup.js";
async function main() {
    const modelName = await setup();
    const sock = await startWhatsApp();
    // 1. Create the runtime instead of a raw session
    const runtime = await createRuntime(modelName);
    // 2. Create the WhatsApp bridge (it subscribes to the active session)
    const handleMessage = createBridge(sock, runtime);
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
    try {
        await sendMessage(sock, ownerJid, welcomeText);
    }
    catch (err) {
        // Fails silently if they've never messaged the bot or network is down
    }
    // Setup WhatsApp event listener
    sock.ev.on("messages.upsert", async ({ messages }) => {
        try {
            for (const msg of messages) {
                if (!msg.message)
                    continue;
                const text = msg.message.conversation
                    ?? msg.message.extendedTextMessage?.text
                    ?? "";
                if (!text.trim())
                    continue;
                const jid = msg.key.remoteJid;
                // Log the incoming message so we know we received it
                console.log(`\n\n=== DEBUG: Received message from ${jid} ===`);
                console.log(`Text: ${text}`);
                console.log(`msg.key.fromMe: ${msg.key.fromMe}`);
                console.log(`ownerNumber: ${ownerNumber}`);
                console.log(`starts with ownerNumber: ${jid.startsWith(ownerNumber)}`);
                if (!jid.startsWith(ownerNumber) && !msg.key.fromMe) {
                    console.log(`DEBUG: Ignoring message because it's not from owner and not fromMe`);
                    continue;
                }
                console.log(`DEBUG: Passing message to bridge...`);
                // Mark the message as read to give the sender double-blue ticks
                await sock.readMessages([msg.key]);
                // When a message comes in, pass it to the bridge
                // The bridge will call runtime.session.prompt(text)
                // Which instantly updates the TUI screen!
                await handleMessage(text.trim(), jid);
            }
        }
        catch (err) {
            // Avoid raw console.error here so we don't break the TUI layout.
            // The bridge handles most errors gracefully.
        }
    });
    // 4. Start the TUI (this takes over the terminal window and blocks)
    await mode.run();
}
main().catch(err => {
    console.error("Failed to start:", err);
    process.exit(1);
});
