/**
 * WhatsApp ↔ pi-coding-agent bridge with chunked streaming.
 *
 * Subscribes to the shared AgentSession's events and forwards
 * assistant output to WhatsApp in periodic chunks.
 * Also handles WhatsApp-only slash commands.
 */

import type {
  AgentSession,
  AgentSessionEvent,
} from "@mariozechner/pi-coding-agent";

const FLUSH_MS = 10_000;

/**
 * Handle a WhatsApp message against the shared session.
 *
 * - Slash commands (/help, /compact, /tokens) are handled locally.
 * - Everything else is forwarded to session.prompt(), with streaming
 *   chunks sent to WhatsApp every ~10s.
 */
export async function handleWhatsAppMessage(
  session: AgentSession,
  text: string,
  sendChunk: (chunk: string) => Promise<void>,
): Promise<string> {
  const cmd = text.trim();

  // ---- WhatsApp-only slash commands ----

  if (cmd === "/help") {
    return [
      "WhatsApp commands:",
      "/compact   — summarize old context",
      "/tokens    — report token usage",
      "/help      — this message",
      "",
      "Everything else is sent to the pi coding agent.",
      "The full agent view is visible in the terminal.",
    ].join("\n");
  }

  if (cmd === "/compact") {
    try {
      const result = await session.compact();
      return `🗜️ compacted (was ~${result.tokensBefore.toLocaleString()} tokens)`;
    } catch (err: any) {
      return `❌ compaction failed: ${err?.message ?? err}`;
    }
  }

  if (cmd === "/tokens") {
    const stats = session.getSessionStats();
    return [
      `📊 session: ${stats.sessionId.slice(0, 8)}`,
      `   messages: ${stats.totalMessages}`,
      `   tokens: ${stats.tokens.total.toLocaleString()} total`,
      `           (in ${stats.tokens.input}, out ${stats.tokens.output})`,
    ].join("\n");
  }

  // ---- Forward to session with streaming capture ----
  return runTurn(session, text, sendChunk);
}

async function runTurn(
  session: AgentSession,
  text: string,
  sendChunk: (chunk: string) => Promise<void>,
): Promise<string> {
  let buffer = "";
  let lastFlush = Date.now();
  let flushing: Promise<void> | null = null;
  let sentChunks = false;

  const flush = async (): Promise<void> => {
    const pending = buffer.trim();
    if (!pending) return;
    buffer = "";
    lastFlush = Date.now();
    try {
      sentChunks = true;
      await sendChunk(pending);
    } catch (err) {
      console.error("[WA] chunk send failed:", err);
    }
  };

  const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
    if (event.type === "message_update") {
      const a = event.assistantMessageEvent;
      if (a.type === "text_delta") buffer += a.delta;
    }

    if (!flushing && Date.now() - lastFlush > FLUSH_MS && buffer.trim()) {
      flushing = flush().finally(() => {
        flushing = null;
      });
    }
  });

  try {
    // Wait until the agent is idle if it's currently busy (e.g. from the TUI or previous msg)
    while (session.isStreaming) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    
    // Now send the prompt and await its full completion
    await session.prompt(text);
  } finally {
    unsubscribe();
  }

  // Drain any in-flight flush, then send remaining buffer.
  if (flushing) await flushing;
  await flush();

  // If the model doesn't support streaming (no text_delta emitted),
  // sentChunks will be false. In that case, return the final complete message.
  if (!sentChunks) {
    return session.getLastAssistantText()?.trim() ?? "";
  }

  // Otherwise, return empty string since we already sent the message via sendChunk
  return "";
}
