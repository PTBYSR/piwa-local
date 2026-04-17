import type {
  AssistantMessage,
  Context,
  Message,
  Model,
  Tool,
} from "@mariozechner/pi-ai";
import { createAssistantMessageEventStream } from "@mariozechner/pi-ai";
import * as fs from "fs";
import * as path from "path";

const LOG_FILE = path.join(process.cwd(), "debug.log");
function olog(...args: unknown[]) {
  const line = `[${new Date().toISOString()}] [OLLAMA] ${args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ")}\n`;
  try {
    fs.appendFileSync(LOG_FILE, line);
  } catch {}
}

type OllamaToolCall = {
  id?: string;
  function?: { name?: string; arguments?: Record<string, unknown> };
};

type OllamaChunk = {
  message?: {
    role?: string;
    content?: string;
    thinking?: string;
    tool_calls?: OllamaToolCall[];
  };
  done?: boolean;
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
};

function toOllamaMessages(context: Context) {
  const out: Array<Record<string, unknown>> = [];
  if (context.systemPrompt) {
    out.push({ role: "system", content: context.systemPrompt });
  }
  for (const msg of context.messages as Message[]) {
    if (msg.role === "user") {
      const text =
        typeof msg.content === "string"
          ? msg.content
          : msg.content
              .filter((c) => c.type === "text")
              .map((c) => (c as { text: string }).text)
              .join("");
      out.push({ role: "user", content: text });
    } else if (msg.role === "assistant") {
      const textParts: string[] = [];
      const toolCalls: OllamaToolCall[] = [];
      for (const c of msg.content) {
        if (c.type === "text") textParts.push(c.text);
        else if (c.type === "toolCall") {
          toolCalls.push({
            function: { name: c.name, arguments: c.arguments },
          });
        }
      }
      const entry: Record<string, unknown> = {
        role: "assistant",
        content: textParts.join(""),
      };
      if (toolCalls.length > 0) entry.tool_calls = toolCalls;
      out.push(entry);
    } else if (msg.role === "toolResult") {
      const text = msg.content
        .filter((c) => c.type === "text")
        .map((c) => (c as { text: string }).text)
        .join("");
      out.push({ role: "tool", content: text });
    }
  }
  return out;
}

function toOllamaTools(tools: Tool[]) {
  return tools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

function newId() {
  return `call_${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * Qwen (and several other local models) frequently emit tool calls as plain
 * text instead of using Ollama's structured `tool_calls` field — typically as
 * a ```json ... ``` fenced block, a <tool_call>...</tool_call> wrapper, or a
 * bare {"name":..., "arguments":...} object. This sniffs the first non-
 * whitespace characters of the model's output to decide whether to buffer
 * silently (and convert at `done`) or stream as normal text.
 */
function looksLikeLeakedToolCall(text: string): boolean {
  const t = text.trimStart();
  if (t.length < 1) return false;
  if (t.startsWith("```json")) return true;
  if (t.startsWith("```\n{") || t.startsWith("```{") || t.startsWith("``` {"))
    return true;
  if (t.startsWith("<tool_call>")) return true;
  if (t.startsWith("<|tool_call|>")) return true;
  // Bare JSON object that is clearly a tool call.
  if (t.startsWith("{")) {
    // If we have enough characters, check for "name" near the front.
    if (t.length < 10) return true; // too early — assume yes, decide later
    return /^\{\s*"name"\s*:/.test(t);
  }
  return false;
}

type ParsedToolCall = { name: string; arguments: Record<string, unknown> };

/**
 * Parse leaked tool-call text into structured calls. Returns the parsed calls
 * plus any leftover text that isn't part of a tool call. Handles:
 *  - ```json\n{...}\n``` fenced blocks
 *  - <tool_call>{...}</tool_call> wrappers
 *  - Bare top-level JSON objects with {"name", "arguments"}
 */
function extractToolCallsFromText(text: string): {
  calls: ParsedToolCall[];
  leftover: string;
} {
  const calls: ParsedToolCall[] = [];
  let leftover = text;

  const tryPush = (obj: unknown): boolean => {
    if (!obj || typeof obj !== "object") return false;
    const o = obj as Record<string, unknown>;
    if (typeof o.name !== "string") return false;
    const args =
      (o.arguments as Record<string, unknown> | undefined) ??
      (o.parameters as Record<string, unknown> | undefined) ??
      {};
    calls.push({ name: o.name, arguments: args });
    return true;
  };

  // 1. <tool_call>{...}</tool_call> (and <|tool_call|>{...}<|/tool_call|>)
  leftover = leftover.replace(
    /<\|?tool_call\|?>([\s\S]*?)<\/?\|?tool_call\|?>/g,
    (match, inner: string) => {
      try {
        if (tryPush(JSON.parse(inner.trim()))) return "";
      } catch {}
      return match;
    },
  );

  // 2. ```json ... ``` fenced blocks
  leftover = leftover.replace(
    /```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/g,
    (match, inner: string) => {
      try {
        if (tryPush(JSON.parse(inner.trim()))) return "";
      } catch {}
      return match;
    },
  );

  // 3. Bare top-level JSON that is a tool call.
  const trimmed = leftover.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      if (tryPush(JSON.parse(trimmed))) {
        leftover = "";
      }
    } catch {}
  }

  return { calls, leftover: leftover.trim() };
}

export function createOllamaNativeStream(
  model: Model<any>,
  context: Context,
  options?: { signal?: AbortSignal; temperature?: number; maxTokens?: number },
) {
  const stream = createAssistantMessageEventStream();

  const output: AssistantMessage = {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  };

  olog("createOllamaNativeStream invoked", {
    model: model.id,
    api: model.api,
    provider: model.provider,
    baseUrl: model.baseUrl,
    msgCount: context.messages?.length ?? 0,
    toolCount: context.tools?.length ?? 0,
  });

  (async () => {
    try {
      const baseUrl = (model.baseUrl || "http://localhost:11434").replace(
        /\/v1\/?$/,
        "",
      );

      const body: Record<string, unknown> = {
        model: model.id,
        messages: toOllamaMessages(context),
        stream: true,
      };
      if (context.tools && context.tools.length > 0) {
        body.tools = toOllamaTools(context.tools);
      }
      const ollamaOptions: Record<string, unknown> = {};
      if (options?.temperature !== undefined)
        ollamaOptions.temperature = options.temperature;
      if (options?.maxTokens !== undefined)
        ollamaOptions.num_predict = options.maxTokens;
      if (Object.keys(ollamaOptions).length > 0) body.options = ollamaOptions;

      olog("POST", `${baseUrl}/api/chat`, {
        model: body.model,
        tools: (body.tools as unknown[] | undefined)?.length ?? 0,
        messages: (body.messages as unknown[]).length,
      });

      const res = await fetch(`${baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: options?.signal,
      });

      olog("fetch returned", { status: res.status, ok: res.ok });

      if (!res.ok || !res.body) {
        const errText = await res.text().catch(() => "");
        olog("fetch NOT OK", res.status, errText);
        output.stopReason = "error";
        output.errorMessage = `Ollama ${res.status}: ${errText || res.statusText}`;
        stream.push({ type: "error", reason: "error", error: output });
        stream.end(output);
        return;
      }

      stream.push({ type: "start", partial: output });

      type Block =
        | { type: "text"; text: string }
        | { type: "thinking"; thinking: string }
        | {
            type: "toolCall";
            id: string;
            name: string;
            arguments: Record<string, unknown>;
          };
      let current: Block | null = null;
      const blockIndex = () => output.content.length - 1;

      const finishCurrent = () => {
        if (!current) return;
        const idx = blockIndex();
        if (current.type === "text") {
          stream.push({
            type: "text_end",
            contentIndex: idx,
            content: current.text,
            partial: output,
          });
        } else if (current.type === "thinking") {
          stream.push({
            type: "thinking_end",
            contentIndex: idx,
            content: current.thinking,
            partial: output,
          });
        } else {
          stream.push({
            type: "toolcall_end",
            contentIndex: idx,
            toolCall: {
              type: "toolCall",
              id: current.id,
              name: current.name,
              arguments: current.arguments,
            },
            partial: output,
          });
        }
        current = null;
      };

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let chunkCount = 0;

      // Text-leak handling. When the model starts emitting `{` / ``` / <tool_call>
      // we enter "leak buffer" mode and silently accumulate until `done`, then
      // parse real tool calls out of the buffer. While this is in "undecided"
      // mode we also hold text back; we commit to streaming only once we have
      // enough evidence the response is plain text.
      type LeakMode = "undecided" | "text" | "leak";
      let leakMode: LeakMode = "undecided";
      let leakBuffer = "";
      const MIN_SNIFF = 12; // chars of non-whitespace before decision

      const enterTextMode = () => {
        leakMode = "text";
        if (leakBuffer.length === 0) return;
        if (!current || current.type !== "text") {
          finishCurrent();
          current = { type: "text", text: "" };
          output.content.push(current as any);
          stream.push({
            type: "text_start",
            contentIndex: blockIndex(),
            partial: output,
          });
        }
        current.text += leakBuffer;
        (output.content[blockIndex()] as any).text = current.text;
        stream.push({
          type: "text_delta",
          contentIndex: blockIndex(),
          delta: leakBuffer,
          partial: output,
        });
        leakBuffer = "";
      };

      const ingestTextChunk = (chunkText: string) => {
        if (leakMode === "leak") {
          leakBuffer += chunkText;
          return;
        }
        if (leakMode === "text") {
          if (!current || current.type !== "text") {
            finishCurrent();
            current = { type: "text", text: "" };
            output.content.push(current as any);
            stream.push({
              type: "text_start",
              contentIndex: blockIndex(),
              partial: output,
            });
          }
          current.text += chunkText;
          (output.content[blockIndex()] as any).text = current.text;
          stream.push({
            type: "text_delta",
            contentIndex: blockIndex(),
            delta: chunkText,
            partial: output,
          });
          return;
        }
        // undecided
        leakBuffer += chunkText;
        const sniff = leakBuffer.trimStart();
        if (sniff.length >= MIN_SNIFF) {
          if (looksLikeLeakedToolCall(leakBuffer)) {
            leakMode = "leak";
            olog("leak buffer mode engaged", { preview: sniff.slice(0, 40) });
          } else {
            enterTextMode();
          }
        }
      };

      const finalizeLeakBuffer = () => {
        if (leakMode === "leak" && leakBuffer.trim().length > 0) {
          const { calls, leftover } = extractToolCallsFromText(leakBuffer);
          olog("leak buffer finalized", {
            calls: calls.length,
            leftoverLen: leftover.length,
          });
          if (calls.length > 0) {
            // Emit any leftover prose as a text block first.
            if (leftover.length > 0) {
              finishCurrent();
              current = { type: "text", text: leftover };
              output.content.push(current as any);
              stream.push({
                type: "text_start",
                contentIndex: blockIndex(),
                partial: output,
              });
              stream.push({
                type: "text_delta",
                contentIndex: blockIndex(),
                delta: leftover,
                partial: output,
              });
              finishCurrent();
            }
            for (const tc of calls) {
              finishCurrent();
              const id = newId();
              current = { type: "toolCall", id, name: tc.name, arguments: tc.arguments };
              output.content.push({
                type: "toolCall",
                id,
                name: tc.name,
                arguments: tc.arguments,
              } as any);
              stream.push({
                type: "toolcall_start",
                contentIndex: blockIndex(),
                partial: output,
              });
              stream.push({
                type: "toolcall_delta",
                contentIndex: blockIndex(),
                delta: JSON.stringify(tc.arguments),
                partial: output,
              });
            }
            leakBuffer = "";
            return;
          }
        }
        // No tool calls detected — fall back to streaming the buffer as text.
        if (leakBuffer.length > 0) {
          enterTextMode();
        }
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          olog("stream reader done", { chunkCount });
          break;
        }
        chunkCount++;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          let chunk: OllamaChunk;
          try {
            chunk = JSON.parse(trimmed);
          } catch {
            continue;
          }

          const msg = chunk.message;
          if (msg) {
            if (msg.thinking && msg.thinking.length > 0) {
              if (!current || current.type !== "thinking") {
                finishCurrent();
                current = { type: "thinking", thinking: "" };
                output.content.push(current as any);
                stream.push({
                  type: "thinking_start",
                  contentIndex: blockIndex(),
                  partial: output,
                });
              }
              current.thinking += msg.thinking;
              (output.content[blockIndex()] as any).thinking = current.thinking;
              stream.push({
                type: "thinking_delta",
                contentIndex: blockIndex(),
                delta: msg.thinking,
                partial: output,
              });
            }

            if (msg.content && msg.content.length > 0) {
              ingestTextChunk(msg.content);
            }

            if (Array.isArray(msg.tool_calls)) {
              for (const tc of msg.tool_calls) {
                finishCurrent();
                const name = tc.function?.name ?? "";
                const args = (tc.function?.arguments ?? {}) as Record<
                  string,
                  unknown
                >;
                const id = tc.id ?? newId();
                current = { type: "toolCall", id, name, arguments: args };
                output.content.push({
                  type: "toolCall",
                  id,
                  name,
                  arguments: args,
                } as any);
                stream.push({
                  type: "toolcall_start",
                  contentIndex: blockIndex(),
                  partial: output,
                });
                stream.push({
                  type: "toolcall_delta",
                  contentIndex: blockIndex(),
                  delta: JSON.stringify(args),
                  partial: output,
                });
              }
            }
          }

          if (chunk.done) {
            // Drain any pending leaked-tool-call buffer before closing blocks.
            finalizeLeakBuffer();
            finishCurrent();
            const inTok = chunk.prompt_eval_count ?? 0;
            const outTok = chunk.eval_count ?? 0;
            output.usage = {
              input: inTok,
              output: outTok,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: inTok + outTok,
              cost: {
                input: 0,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
                total: 0,
              },
            };
            const hasTool = output.content.some((c) => c.type === "toolCall");
            const reason: "stop" | "length" | "toolUse" = hasTool
              ? "toolUse"
              : chunk.done_reason === "length"
                ? "length"
                : "stop";
            output.stopReason = reason;
            stream.push({ type: "done", reason, message: output });
          }
        }
      }

      stream.end(output);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      olog("EXCEPTION in stream", msg, (e as Error)?.stack);
      const aborted =
        (e as { name?: string })?.name === "AbortError" ||
        /aborted/i.test(msg);
      output.stopReason = aborted ? "aborted" : "error";
      output.errorMessage = msg;
      stream.push({
        type: "error",
        reason: aborted ? "aborted" : "error",
        error: output,
      });
      stream.end(output);
    }
  })();

  return stream;
}
