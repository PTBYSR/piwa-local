/**
 * PIWA — Pi WhatsApp Agent with native terminal TUI.
 *
 * Starts two systems sharing one AgentSession:
 *   1. The native pi InteractiveMode TUI (full terminal coding-agent view)
 *   2. A WhatsApp bridge (Baileys) that mirrors messages in/out
 *
 * Messages from WhatsApp appear in the TUI as user messages.
 * Agent responses are rendered in the TUI AND sent back via WhatsApp.
 * You can also type directly in the TUI — WhatsApp is just a remote input.
 */

import * as fs from "fs";
import * as path from "path";
import { getModel } from "@mariozechner/pi-ai";
import {
  AuthStorage,
  SessionManager,
  InteractiveMode,
  createAgentSessionRuntime,
  createAgentSessionFromServices,
  createAgentSessionServices,
  getAgentDir,
  initTheme,
  type CreateAgentSessionRuntimeFactory,
} from "@mariozechner/pi-coding-agent";

import { createWhatsAppBridge, type WhatsAppBridge } from "./whatsapp.js";
import { handleWhatsAppMessage } from "./agent.js";
import { loadOrPromptConfig, deleteConfig } from "./setup.js";

// -----------------------------------------------------------------------------
// Bootstrap
// -----------------------------------------------------------------------------

async function main() {
  const cwd = process.cwd();
  const agentDir = getAgentDir();
  const authStorage = AuthStorage.create();

  // ---- Create runtime factory (simplified from pi's main.ts) ----
  const createRuntime: CreateAgentSessionRuntimeFactory = async ({
    cwd: runtimeCwd,
    agentDir: runtimeAgentDir,
    sessionManager,
    sessionStartEvent,
  }) => {
    const services = await createAgentSessionServices({
      cwd: runtimeCwd,
      agentDir: runtimeAgentDir,
      authStorage,
      resourceLoaderOptions: {
        appendSystemPrompt: [
          "You are PIWA, a WhatsApp AI coding agent. When the user says a generic greeting like 'hi', 'hello', or 'hey', SIMPLY greet them back and ask how you can help. DO NOT autonomously explore the filesystem or project inventory unless explicitly requested to do so. Keep your WhatsApp responses concise."
        ]
      }
    });

    const { settingsManager, modelRegistry } = services;

    // 1. Try to use the developer's default model from ~/.pi/agent/settings.json
    const savedProvider = settingsManager.getDefaultProvider();
    const savedModelId = settingsManager.getDefaultModel();
    
    let model;
    if (savedProvider && savedModelId) {
      model = modelRegistry.find(savedProvider, savedModelId);
    }
    
    // 2. If no default is set, pick the very first model the user has an API key for
    if (!model) {
      const allModels = modelRegistry.getAll();
      model = allModels.length > 0 ? allModels[0] : getModel("google", "gemini-2.5-flash");
    }

    if (!model) {
      throw new Error("No models available. Please set an API key using the pi CLI.");
    }

    const created = await createAgentSessionFromServices({
      services,
      sessionManager,
      sessionStartEvent,
      model,
      thinkingLevel: "medium",
    });

    return {
      ...created,
      services,
      diagnostics: [...services.diagnostics],
    };
  };

  // ---- Create session manager ----
  const sessionManager = SessionManager.create(cwd);

  // ---- Build runtime ----
  const runtime = await createAgentSessionRuntime(createRuntime, {
    cwd,
    agentDir,
    sessionManager,
  });

  const { services } = runtime;
  const { settingsManager } = services;

  // ---- Initialize theme ----
  initTheme(settingsManager.getTheme(), true);

  // ---- Start the native pi TUI (don't render yet) ----
  const interactiveMode = new InteractiveMode(runtime, {
    verbose: false,
  });

  // ---- The Retry Loop for WhatsApp Connection ----
  let waBridge: WhatsAppBridge | null = null;
  let waProcessing: Promise<unknown> = Promise.resolve();

  while (!waBridge) {
    const config = await loadOrPromptConfig();

    console.log("⏳ Initializing WhatsApp connection...");

    try {
      waBridge = await createWhatsAppBridge({
        authDir: path.join(cwd, ".piwa-auth"),
        agentNumber: config.agentNumber,
        ownerNumber: config.ownerNumber,
        onMessage: (text, jid, pushName, bridge) => {
          if (!bridge) return;
          
          waProcessing = waProcessing.then(async () => {
            bridge.startTyping(jid);

            const sendChunk = async (chunk: string) => {
              await bridge.sendMessage(jid, chunk);
            };

            try {
              const reply = await handleWhatsAppMessage(
                runtime.session,
                text,
                sendChunk,
              );
              
              if (reply) {
                await bridge.sendMessage(jid, reply);
              }
            } catch (err: any) {
              const errorMsg = err?.message?.toLowerCase() || "";

              if (errorMsg.includes("api key")) {
                const authHelpMsg = 
                  "⚠️ *API Key Missing!*\n\n" +
                  "The WhatsApp bridge is working perfectly, but the AI engine is not authenticated on your computer.\n\n" +
                  "*To fix this, go to your computer's terminal and do ONE of the following:*\n\n" +
                  "1️⃣ Type `/login` in the terminal to authorize via your web browser.\n" +
                  "2️⃣ Type a message (e.g., 'hello') directly into the terminal, and it will prompt you to paste your key.\n" +
                  "3️⃣ Stop the bot and set an environment variable before restarting:\n" +
                  "`export GEMINI_API_KEY=your_key_here`\n\n" +
                  "Once you do that, message me here again!";
                  
                await bridge.sendMessage(jid, authHelpMsg).catch(() => {});
              } else {
                await bridge
                  .sendMessage(jid, "⚠️ agent error, check terminal")
                  .catch(() => {});
              }
            } finally {
              bridge.stopTyping(jid);
            }
          }).catch(err => {});
        },
      });
    } catch (err: any) {
      const errMsg = err?.message || "";
      if (errMsg === "BAD_AGENT_NUMBER" || errMsg === "BAD_OWNER_NUMBER") {
        console.log("\n⚠️ WhatsApp rejected the numbers. Let's try again.\n");
        deleteConfig(); // Delete the bad config file so it prompts again next loop
      } else {
        console.log("\n⚠️ WhatsApp connection dropped (Timeout). Retrying with the same numbers...\n");
        // We DO NOT delete the config file here!
      }
      
      // Short delay before the loop restarts
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }

  // ---- Graceful shutdown ----
  process.on("SIGINT", () => {
    console.log("\n\n🛑 Setup cancelled by user. Exiting PIWA...");
    waBridge?.close();
    process.exit(0);
  });

  // ---- Take over the screen with the TUI ----
  console.log("🚀 Booting up Pi Terminal UI...");
  await interactiveMode.run();
}

main().catch((err) => {
  console.error("Failed to start PIWA:", err);
  process.exit(1);
});
