import { WASocket } from '@whiskeysockets/baileys';
import { AgentSessionRuntime, AgentSession } from '@mariozechner/pi-coding-agent';
import { getModel, getApiProvider } from '@mariozechner/pi-ai';
import { sendMessage, sendPresence } from './whatsapp.js';
import { format } from './formatter.js';
import { dbg } from './index.js';
import { ensureOllamaApiRegistered } from './agent.js';

export function createBridge(runtime: AgentSessionRuntime) {
  let unsubscribe: (() => void) | undefined;
  let activeSession: AgentSession | undefined;
  
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
      dbg(`[BRIDGE EVENT] type=${event.type}`);

      // Surface the silent error path. pi-agent-core's runWithLifecycle
      // catches exceptions from runAgentLoop, stuffs them into a synthetic
      // agent_end with stopReason: "error" and errorMessage set, then moves
      // on. Without logging this we see "empty 5ms turn" with no clue why.
      if (event.type === "agent_end") {
        const anyEvt = event as any;
        const msgs = anyEvt.messages ?? [];
        for (const m of msgs) {
          if (m?.stopReason && m.stopReason !== "stop" && m.stopReason !== "toolUse") {
            dbg(
              `[BRIDGE EVENT] agent_end stopReason=${m.stopReason} errorMessage=${m.errorMessage ?? "(none)"}`,
            );
            if (currentJid && m.errorMessage) {
              try {
                await sendMessage(currentJid, `⚠️ ${m.errorMessage}`);
              } catch {}
            }
          }
        }
      }

      try {
        if (event.type === "message_update") {
          // Only capture actual text meant for the user
          if (event.assistantMessageEvent.type === "text_delta") {
            const chunk = event.assistantMessageEvent.delta;
            currentBuffer += chunk;
          }
        } else if (event.type === "tool_execution_start") {
          // If the model previously generated some text before deciding to run a tool,
          // we should flush that text to WhatsApp now, before the tool indicator.
          if (currentBuffer.trim() && currentJid) {
            const formatted = format(currentBuffer);
            await sendMessage(currentJid, formatted);
            currentBuffer = "";
          }

          const firstArg = event.args ? Object.values(event.args)[0] : undefined;
          let preview = firstArg ? String(firstArg) : "";
          if (preview.length > 50) preview = preview.substring(0, 47) + "...";
          
          if (currentJid) {
            await sendMessage(currentJid, `⏳ *[${event.toolName}]* \n\`${preview}\``);
          }
        } else if (event.type === "turn_end") {
          // The turn has completely ended (both text and tools)
          if (currentBuffer.trim() && currentJid) {
            const formatted = format(currentBuffer);
            await sendMessage(currentJid, formatted);
            currentBuffer = "";
          }
        }
      } catch (err: unknown) {
        if (currentJid) {
          const msg = err instanceof Error ? err.message : String(err);
          await sendMessage(currentJid, `⚠️ ${msg}`);
        }
      }
    });
  }

  // Initial binding
  ensureSubscription();

  return async function handleMessage(text: string, jid: string): Promise<void> {
    currentJid = jid;
    
        // Make sure we are attached to the right session before processing
    ensureSubscription();
    
    dbg(`[BRIDGE] handleMessage called. jid=${jid}, text="${text}"`);
    
    try {
      if (text.startsWith('/')) {
        const parts = text.split(' ');
        const cmd = parts[0];
        const arg = parts.slice(1).join(' ');

        switch (cmd) {
          case '/new':
            await runtime.newSession();
            ensureSubscription();
            await sendMessage(jid, "✅ New session started.");
            break;

          case '/model':
            if (!arg) {
              await sendMessage(jid, "⚠️ Usage: /model <name>");
              break;
            }
            // @ts-ignore
            const model = getModel("ollama-native", arg);
            if (!model) {
              await sendMessage(jid, "⚠️ Model unavailable. Is Ollama running?");
            } else {
              runtime.session.agent.state.model = model;
              await sendMessage(jid, `✅ Model switched to ${arg}`);
            }
            break;

          case '/compact':
            await runtime.session.agent.prompt("/compact");
            await sendMessage(jid, "✅ Compacted context.");
            break;

          case '/session':
            const modelName = runtime.session.agent.state.model?.id || "unknown";
            const msgCount = runtime.session.agent.state.messages.length;
            await sendMessage(jid, `ℹ️ Model: ${modelName}\nMessages: ${msgCount}`);
            break;

          case '/help':
            const helpText = `Available commands:
/new - Start a new session
/model <name> - Switch Ollama model
/compact - Compact context
/session - Show session info
/help - Show this message`;
            await sendMessage(jid, helpText);
            break;

          default:
            await sendMessage(jid, `⚠️ Unknown command: ${cmd}`);
            break;
        }
        return;
      }

      // Normal message
      try {
        await sendPresence(jid, 'composing');

        // Instant visual feedback for the user
        await sendMessage(jid, `⏳ *Thinking...*`);

        // Re-assert our api handler on pi-ai's global registry. pi-coding-agent
        // wipes non-builtin handlers via resetApiProviders() during session
        // init / refresh, so we need this before every prompt.
        ensureOllamaApiRegistered();
        dbg(
          `[BRIDGE] ensured ollama-chat handler, present=${!!getApiProvider("ollama-chat" as any)}; calling session.prompt()...`,
        );

        // Pass prompt to the agent framework.
        await runtime.session.prompt(text);
        dbg('[BRIDGE] session.prompt() resolved.');
      } catch (err: unknown) {
        let msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("fetch failed") || msg.includes("ECONNREFUSED")) {
          msg = "Model unavailable. Is Ollama running?";
        }
        await sendMessage(jid, `⚠️ ${msg}`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      await sendMessage(jid, `⚠️ ${msg}`);
    }
  };
}
