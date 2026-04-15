import { getModel } from '@mariozechner/pi-ai';
import { sendMessage } from './whatsapp.js';
import { format } from './formatter.js';
export function createBridge(sock, runtime) {
    let unsubscribe;
    let activeSession;
    let currentBuffer = "";
    let currentJid = "";
    // Function to ensure we are always subscribed to the correct runtime session
    function ensureSubscription() {
        if (activeSession === runtime.session) {
            return; // Already subscribed to the current active session
        }
        // Clean up old subscription
        if (unsubscribe) {
            unsubscribe();
        }
        activeSession = runtime.session;
        currentBuffer = "";
        unsubscribe = activeSession.subscribe(async (event) => {
            try {
                if (event.type === "message_update") {
                    // Only capture actual text meant for the user
                    if (event.assistantMessageEvent.type === "text_delta") {
                        const chunk = event.assistantMessageEvent.delta;
                        currentBuffer += chunk;
                    }
                }
                else if (event.type === "tool_execution_start") {
                    // If the model previously generated some text before deciding to run a tool,
                    // we should flush that text to WhatsApp now, before the tool indicator.
                    if (currentBuffer.trim() && currentJid) {
                        const formatted = format(currentBuffer);
                        await sendMessage(sock, currentJid, formatted);
                        currentBuffer = "";
                    }
                    const firstArg = event.args ? Object.values(event.args)[0] : undefined;
                    let preview = firstArg ? String(firstArg) : "";
                    if (preview.length > 50)
                        preview = preview.substring(0, 47) + "...";
                    if (currentJid) {
                        await sendMessage(sock, currentJid, `⏳ *[${event.toolName}]* \n\`${preview}\``);
                    }
                }
                else if (event.type === "turn_end") {
                    // The turn has completely ended (both text and tools)
                    if (currentBuffer.trim() && currentJid) {
                        const formatted = format(currentBuffer);
                        await sendMessage(sock, currentJid, formatted);
                        currentBuffer = "";
                    }
                }
            }
            catch (err) {
                if (currentJid) {
                    const msg = err instanceof Error ? err.message : String(err);
                    await sendMessage(sock, currentJid, `⚠️ ${msg}`);
                }
            }
        });
    }
    // Initial binding
    ensureSubscription();
    return async function handleMessage(text, jid) {
        currentJid = jid;
        // Make sure we are attached to the right session before processing
        ensureSubscription();
        console.log(`\n=== DEBUG: Bridge handling message from ${jid} ===`);
        console.log(`Text: ${text}`);
        try {
            if (text.startsWith('/')) {
                const parts = text.split(' ');
                const cmd = parts[0];
                const arg = parts.slice(1).join(' ');
                switch (cmd) {
                    case '/new':
                        await runtime.newSession();
                        ensureSubscription();
                        await sendMessage(sock, jid, "✅ New session started.");
                        break;
                    case '/model':
                        if (!arg) {
                            await sendMessage(sock, jid, "⚠️ Usage: /model <name>");
                            break;
                        }
                        // @ts-ignore
                        const model = getModel("ollama", arg);
                        if (!model) {
                            await sendMessage(sock, jid, "⚠️ Model unavailable. Is Ollama running?");
                        }
                        else {
                            runtime.session.agent.state.model = model;
                            await sendMessage(sock, jid, `✅ Model switched to ${arg}`);
                        }
                        break;
                    case '/compact':
                        await runtime.session.agent.prompt("/compact");
                        await sendMessage(sock, jid, "✅ Compacted context.");
                        break;
                    case '/session':
                        const modelName = runtime.session.agent.state.model?.id || "unknown";
                        const msgCount = runtime.session.agent.state.messages.length;
                        await sendMessage(sock, jid, `ℹ️ Model: ${modelName}\nMessages: ${msgCount}`);
                        break;
                    case '/help':
                        const helpText = `Available commands:
/new - Start a new session
/model <name> - Switch Ollama model
/compact - Compact context
/session - Show session info
/help - Show this message`;
                        await sendMessage(sock, jid, helpText);
                        break;
                    default:
                        await sendMessage(sock, jid, `⚠️ Unknown command: ${cmd}`);
                        break;
                }
                return;
            }
            // Normal message
            try {
                await sock.sendPresenceUpdate('composing', jid);
                // Instant visual feedback for the user
                await sendMessage(sock, jid, `⏳ *Thinking...*`);
                // Pass prompt to the agent framework.
                await runtime.session.prompt(text);
            }
            catch (err) {
                let msg = err instanceof Error ? err.message : String(err);
                if (msg.includes("fetch failed") || msg.includes("ECONNREFUSED")) {
                    msg = "Model unavailable. Is Ollama running?";
                }
                await sendMessage(sock, jid, `⚠️ ${msg}`);
            }
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            await sendMessage(sock, jid, `⚠️ ${msg}`);
        }
    };
}
