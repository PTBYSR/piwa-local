WhatsApp Coding Agent Bridge

## What You Are Building

A minimal Node.js/TypeScript app that makes the pi coding agent accessible via WhatsApp DMs
instead of the terminal. The terminal is replaced entirely — WhatsApp is the input surface,
WhatsApp is the output surface. Everything else (the agent, tools, model, sessions) is
untouched and runs locally with zero internet dependency (except WhatsApp's own connection).

---

## Reference Documentation

Before writing any code, read the following:

- `@mariozechner/pi-coding-agent` SDK docs: https://github.com/badlogic/pi-mono — specifically
  `docs/sdk.md` and `examples/sdk/` for how to instantiate and drive an agent session
  programmatically.

- `@mariozechner/pi-agent-core` README — focus on the Agent class, event types
  (`agent_start`, `turn_start`, `message_update`, `message_end`, `tool_execution_start`,
  `tool_execution_end`, `agent_end`), the `subscribe()` method, and `session.prompt()`.

- Baileys docs: https://github.com/WhiskeySockets/Baileys — focus on socket creation,
  `usePairingCode`, credential storage with `useMultiFileAuthState`, and the
  `messages.upsert` event.

- Ollama API: http://localhost:11434 — models are addressed as `ollama/gemma3n:e4b`.
  Ollama speaks an OpenAI-compatible API.

---

## Constraints — Read These First

- **Minimal above all else.** No unnecessary abstractions, no classes where functions
  suffice, no frameworks. If something can be a plain function, it is.
- **No external state stores.** No Redis, no SQLite, no databases. Baileys handles its
  own credential persistence. Pi SDK handles session persistence.
- **No streaming to WhatsApp.** Buffer all `message_update` deltas silently, send one
  complete message on `message_end`.
- **TypeScript only.** Strict mode on. No `any`.
- **One process.** Baileys and the pi SDK session live in the same Node.js process.
- **One session per user.** The app supports a single WhatsApp sender for now. No
  multi-user complexity.

---

## Project Structure

```
/
├── src/
│   ├── index.ts         ← entry point, wires everything together
│   ├── whatsapp.ts      ← Baileys connection and pairing code auth
│   ├── agent.ts         ← pi SDK session creation and management
│   ├── bridge.ts        ← routes WhatsApp messages → agent, agent events → WhatsApp
│   └── formatter.ts     ← converts raw agent output to WhatsApp-safe text
├── .env
├── package.json
└── tsconfig.json
```

No more files than this. No `utils.ts` catch-all. Each file has one clear job.

---

## Environment Variables (`.env`)

```env
WORK_DIR=/absolute/path/to/project     # directory the agent operates in
OLLAMA_MODEL=gemma3n:e4b               # model to use
PHONE_NUMBER=2348XXXXXXXXX             # your WhatsApp number, no + or spaces
```

---

## Implementation Spec Per File

### `src/whatsapp.ts`

Responsibility: own the Baileys socket lifecycle.

- Use `useMultiFileAuthState("auth")` to persist credentials in an `auth/` folder.
- Create the socket with `usePairingCode: true`, `printQRInTerminal: false`.
- On `connection.update`: if not registered, call `sock.requestPairingCode(PHONE_NUMBER)`
  and print the code to stdout — this is the one-time setup step.
- On reconnect (credentials already exist), reconnect silently with no user action needed.
- Export two things only:
  - `startWhatsApp(): Promise<WASocket>` — starts connection, returns socket when ready
  - `sendMessage(sock, jid, text): Promise<void>` — sends a plain text message

Handle long text by splitting on a 3500 character limit before sending, sending each
chunk sequentially. This lives here in `sendMessage`, not in the bridge.

### `src/agent.ts`

Responsibility: create and expose the pi agent session.

- Import `AuthStorage`, `ModelRegistry`, `SessionManager`, `createAgentSession` from
  `@mariozechner/pi-coding-agent`.
- Import `getModel` from `@mariozechner/pi-ai`.
- Point the model at Ollama: `getModel("ollama", process.env.OLLAMA_MODEL)`.
- Use `SessionManager.inMemory()` for now (simplest, no disk session management needed
  for v1).
- Set the working directory to `process.env.WORK_DIR`.
- Export one thing: `createSession(): Promise<AgentSession>`.

### `src/formatter.ts`

Responsibility: convert raw agent text to WhatsApp-readable output.

WhatsApp renders ` ``` ` as monospace blocks. It does not render markdown headers,
bold via `**`, or bullet lists in any special way.

Apply these transformations in order:

1. Strip markdown headers (`## Foo` → `Foo`)
2. Preserve ` ``` ` code blocks as-is (WhatsApp renders these)
3. Convert `**bold**` → `*bold*` (WhatsApp bold syntax)
4. Trim excessive blank lines (max 2 consecutive newlines)

Export one thing: `format(raw: string): string`.

### `src/bridge.ts`

Responsibility: route messages in both directions.

```
WhatsApp message → is it a /command? → handle it
                 → otherwise → session.prompt() → buffer events → send reply
```

**Command handling** — implement as a simple map of command string to handler function.
Commands to support:

| WhatsApp message | Action |
|---|---|
| `/new` | call `createSession()`, replace current session reference |
| `/model <name>` | `session.agent.state.model = getModel("ollama", name)` |
| `/compact` | `session.agent.prompt("/compact")` |
| `/session` | reply with current session info (model name, message count) |
| `/help` | reply with the list of available commands |

Skip: `/login`, `/logout`, `/copy`, `/export`, `/share`, `/hotkeys`, `/quit`,
`/changelog`, `/tree`, `/fork` — these are terminal-specific and meaningless here.

**Agent event subscription** — subscribe once per session on creation:

```
tool_execution_start → send "🔧 <toolName>: <first arg if present>"
message_update       → append delta to buffer (do not send)
message_end          → format buffer, send via Baileys, clear buffer
agent_end            → no-op
errors               → send "⚠️ <error message>"
```

Export one thing: `createBridge(sock, session)` — returns an async function
`handleMessage(text: string, jid: string): Promise<void>`.

### `src/index.ts`

Responsibility: wire everything together and nothing else.

```typescript
const sock = await startWhatsApp();
const session = await createSession();
const handleMessage = createBridge(sock, session);

sock.ev.on("messages.upsert", async ({ messages }) => {
  for (const msg of messages) {
    if (!msg.message || msg.key.fromMe) continue;
    const text = msg.message.conversation
               ?? msg.message.extendedTextMessage?.text
               ?? "";
    if (!text.trim()) continue;
    await handleMessage(text.trim(), msg.key.remoteJid!);
  }
});
```

That is the entire `index.ts`. No logic lives here.

---

## package.json

```json
{
  "name": "pi-whatsapp-agent",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "start": "tsx src/index.ts",
    "build": "tsc"
  },
  "dependencies": {
    "@mariozechner/pi-coding-agent": "latest",
    "@mariozechner/pi-agent-core": "latest",
    "@mariozechner/pi-ai": "latest",
    "@whiskeysockets/baileys": "latest",
    "dotenv": "latest"
  },
  "devDependencies": {
    "tsx": "latest",
    "typescript": "latest",
    "@types/node": "latest"
  }
}
```

---

## tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

---

## Error Handling Rules

- Wrap `session.prompt()` in try/catch. On error, send `⚠️ <error.message>` via Baileys.
- Wrap Baileys `sendMessage` in try/catch. Log failures to console, do not crash.
- On Ollama being unreachable, send `⚠️ Model unavailable. Is Ollama running?`.
- Never let an unhandled error crash the process. Wrap the `messages.upsert` handler
  in a top-level try/catch.

---

## What NOT to Build

- No web UI, no REST API, no dashboard.
- No database or external state.
- No multi-user support.
- No message queue or job runner.
- No Docker setup.
- No tests for v1.
- No logging library — `console.log` is fine.
- No retry logic beyond what Baileys handles natively.
- No message reactions or WhatsApp-specific features (read receipts, typing indicators).

---

## Done Criteria

The app is complete when:

1. `npm start` prints a pairing code on first run.
2. Entering the code in WhatsApp → Linked Devices links the number.
3. Subsequent `npm start` reconnects with no user action.
4. Sending a plain message triggers the agent and returns a response.
5. Tool executions send a brief `🔧 toolName` notification mid-response.
6. `/new`, `/model`, `/compact`, `/session`, `/help` all work correctly.
7. Responses longer than 3500 characters are split into sequential messages.
8. The agent operates on the directory specified in `WORK_DIR`.