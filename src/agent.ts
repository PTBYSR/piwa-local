/**
 * Agent bridge: WhatsApp text → pi-coding-agent session → text reply.
 *
 * Owns:
 *   - Named, persisted conversations (Map<name, AgentSession>).
 *   - conversations.json index (name → pi session-file path).
 *   - Slash-command router (/new, /list, /switch, /resume, /rename,
 *     /delete, /compact, /tokens, /help).
 *   - Per-session concurrency lock.
 *   - Chunked streaming — callback fires every ~10s with accumulated output.
 */

import * as fs from "fs";
import * as path from "path";
import {
  AuthStorage,
  ModelRegistry,
  SessionManager,
  createAgentSession,
  type AgentSession,
  type AgentSessionEvent,
} from "@mariozechner/pi-coding-agent";

const WORK_DIR = process.env.WORK_DIR || process.cwd();
const INDEX_FILE = path.join(WORK_DIR, "conversations.json");
const FLUSH_MS = 10_000;

const authStorage = AuthStorage.create();
const modelRegistry = ModelRegistry.create(authStorage);

// name → pi session-file path. Persists across restarts.
const conversationIndex: Record<string, string> = fs.existsSync(INDEX_FILE)
  ? JSON.parse(fs.readFileSync(INDEX_FILE, "utf8"))
  : {};
const sessions = new Map<string, AgentSession>();
let activeId = Object.keys(conversationIndex)[0] ?? "default";

function saveIndex(): void {
  fs.writeFileSync(INDEX_FILE, JSON.stringify(conversationIndex, null, 2));
}

async function makeSession(): Promise<AgentSession> {
  const { session } = await createAgentSession({
    sessionManager: SessionManager.create(WORK_DIR),
    authStorage,
    modelRegistry,
  });
  return session;
}

async function openSession(filePath: string): Promise<AgentSession> {
  const { session } = await createAgentSession({
    sessionManager: SessionManager.open(filePath),
    authStorage,
    modelRegistry,
  });
  return session;
}

async function getSession(name: string): Promise<AgentSession> {
  const existing = sessions.get(name);
  if (existing) return existing;

  const filePath = conversationIndex[name];
  const session =
    filePath && fs.existsSync(filePath)
      ? await openSession(filePath)
      : await makeSession();

  // Record the new session's file path so /list and future restarts find it.
  const sessionFile = session.sessionFile;
  if (sessionFile) {
    conversationIndex[name] = sessionFile;
    saveIndex();
  }
  sessions.set(name, session);
  return session;
}

// Serialize ask() calls per session so two rapid WhatsApp messages
// don't race on the same conversation history.
const locks = new Map<string, Promise<unknown>>();
function withLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(id) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  locks.set(id, next);
  return next.finally(() => {
    if (locks.get(id) === next) locks.delete(id);
  }) as Promise<T>;
}

const HELP_TEXT = [
  "/new [name]         start a new conversation",
  "/list               list conversations (* = active)",
  "/switch <name>      switch active conversation",
  "/resume <name>      reload a persisted conversation",
  "/rename <a> <b>     rename a conversation",
  "/delete <name>      remove a conversation",
  "/compact            summarize old context now",
  "/tokens             report active session token usage",
  "/help               this message",
].join("\n");

export async function ask(
  text: string,
  sendChunk: (chunk: string) => Promise<void>,
): Promise<string> {
  const cmd = text.trim();

  // ---- Command router ----

  if (cmd === "/help") return HELP_TEXT;

  if (cmd === "/list") {
    const names = Object.keys(conversationIndex);
    return names.length
      ? names.map((k) => (k === activeId ? `* ${k}` : `  ${k}`)).join("\n")
      : "(no conversations yet — send a message or /new <name>)";
  }

  if (cmd.startsWith("/new")) {
    const name = cmd.slice(4).trim() || `chat-${Date.now()}`;
    if (conversationIndex[name]) return `❌ '${name}' already exists`;
    const session = await makeSession();
    sessions.set(name, session);
    if (session.sessionFile) conversationIndex[name] = session.sessionFile;
    saveIndex();
    activeId = name;
    return `✅ new conversation '${name}' (active)`;
  }

  if (cmd.startsWith("/switch")) {
    const name = cmd.slice(7).trim();
    if (!name) return "usage: /switch <name>";
    if (!conversationIndex[name]) return `❌ no conversation '${name}'`;
    activeId = name;
    return `→ switched to '${name}'`;
  }

  if (cmd.startsWith("/resume")) {
    const name = cmd.slice(7).trim();
    if (!name) return "usage: /resume <name>";
    if (!conversationIndex[name]) return `❌ no conversation '${name}'`;
    sessions.get(name)?.dispose();
    sessions.delete(name);
    activeId = name;
    await getSession(name);
    return `📂 resumed '${name}'`;
  }

  if (cmd.startsWith("/rename")) {
    const [, oldN, newN] = cmd.split(/\s+/);
    if (!oldN || !newN) return "usage: /rename <old> <new>";
    if (!conversationIndex[oldN]) return `❌ no conversation '${oldN}'`;
    if (conversationIndex[newN]) return `❌ '${newN}' already exists`;
    conversationIndex[newN] = conversationIndex[oldN];
    delete conversationIndex[oldN];
    const session = sessions.get(oldN);
    if (session) {
      sessions.set(newN, session);
      sessions.delete(oldN);
    }
    if (activeId === oldN) activeId = newN;
    saveIndex();
    return `✏️ renamed '${oldN}' → '${newN}'`;
  }

  if (cmd.startsWith("/delete")) {
    const name = cmd.slice(7).trim();
    if (!name) return "usage: /delete <name>";
    const filePath = conversationIndex[name];
    if (!filePath) return `❌ no conversation '${name}'`;
    sessions.get(name)?.dispose();
    sessions.delete(name);
    delete conversationIndex[name];
    saveIndex();
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch {}
    if (activeId === name) activeId = Object.keys(conversationIndex)[0] ?? "default";
    return `🗑️ deleted '${name}'`;
  }

  if (cmd === "/compact") {
    const session = await getSession(activeId);
    try {
      const result = await session.compact();
      return `🗜️ compacted (was ~${result.tokensBefore.toLocaleString()} tokens)`;
    } catch (err: any) {
      return `❌ compaction failed: ${err?.message ?? err}`;
    }
  }

  if (cmd === "/tokens") {
    const session = await getSession(activeId);
    const stats = session.getSessionStats();
    return [
      `📊 session: ${activeId}`,
      `   messages: ${stats.totalMessages}`,
      `   tokens: ${stats.tokens.total.toLocaleString()} total`,
      `           (in ${stats.tokens.input}, out ${stats.tokens.output},`,
      `            cache r/w ${stats.tokens.cacheRead}/${stats.tokens.cacheWrite})`,
    ].join("\n");
  }

  // ---- Actual LLM turn, serialized per session ----
  return withLock(activeId, () => runTurn(activeId, text, sendChunk));
}

async function runTurn(
  id: string,
  text: string,
  sendChunk: (chunk: string) => Promise<void>,
): Promise<string> {
  const session = await getSession(id);

  let buffer = "";
  let lastFlush = Date.now();
  let flushing: Promise<void> | null = null;

  const flush = async (): Promise<void> => {
    const pending = buffer.trim();
    if (!pending) return;
    buffer = "";
    lastFlush = Date.now();
    try {
      await sendChunk(pending);
    } catch (err) {
      console.error("[Agent] chunk send failed:", err);
    }
  };

  const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
    if (event.type === "tool_execution_start") {
      buffer += `\n🔧 ${event.toolName}…`;
    } else if (event.type === "message_update") {
      const a = event.assistantMessageEvent;
      if (a.type === "text_delta") buffer += a.delta;
    } else if (event.type === "compaction_start") {
      buffer += "\n🗜️ compacting context…";
    }

    if (!flushing && Date.now() - lastFlush > FLUSH_MS && buffer.trim()) {
      flushing = flush().finally(() => {
        flushing = null;
      });
    }
  });

  try {
    await session.prompt(text);
  } finally {
    unsubscribe();
  }

  // Drain any in-flight flush, then send tail.
  if (flushing) await flushing;
  await flush();

  return session.getLastAssistantText()?.trim() ?? "";
}
