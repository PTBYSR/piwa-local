import {
  AuthStorage,
  ModelRegistry,
  SessionManager,
  type CreateAgentSessionRuntimeFactory,
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  createCodingTools,
  getAgentDir,
} from "@mariozechner/pi-coding-agent";
import type { AgentSessionRuntime } from "@mariozechner/pi-coding-agent";
import { type Model } from "@mariozechner/pi-ai";
import { webSearchTool } from "./web-search.js";
import { streamSimpleOpenAICompletions, createAssistantMessageEventStream } from "@mariozechner/pi-ai";

function createQwenToolFixStream(model: any, context: any, options: any) {
  // CRITICAL FIX: Ollama's OpenAI compatibility layer fails to parse Qwen2.5-coder's 
  // tool calls, returning them as raw JSON text in the 'content' field.
  // This stream wrapper intercepts the text stream. If the text forms a valid JSON 
  // tool call, it transforms the text events into native toolcall events that 
  // pi-coding-agent understands, bypassing Ollama's broken parser!
  const originalStream = streamSimpleOpenAICompletions(model, context, options);
  const wrapper = createAssistantMessageEventStream();
  
  (async () => {
    let buffer = "";
    let isBuffering = false;
    let bufferedEvents: any[] = [];
    
    try {
      for await (const event of originalStream) {
        if (event.type === "text_start") {
          buffer = "";
          isBuffering = true;
          bufferedEvents.push(event);
        } else if (event.type === "text_delta") {
          if (isBuffering) {
            buffer += event.delta;
            bufferedEvents.push(event);
            // We buffer EVERYTHING until text_end so we can parse it fully.
          } else {
            wrapper.push(event);
          }
        } else if (event.type === "text_end") {
          if (isBuffering) {
            // Attempt to parse as tool call using regex extraction
            try {
              let jsonStr = buffer.trim();

              // Strip <think>...</think> blocks before parsing
              jsonStr = jsonStr.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

              // Strip markdown code fences if present
              jsonStr = jsonStr.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

              // Extract anything that looks like {"name": "...", "arguments": {...}}
              const match = jsonStr.match(/\{[\s\S]*?"name"[\s\S]*?"arguments"[\s\S]*?\}(?=\s*$|\s*```)/);
              if (match) {
                jsonStr = match[0];
              }

              const parsed = JSON.parse(jsonStr);
              
              if (parsed && typeof parsed.name === 'string' && typeof parsed.arguments === 'object') {
                const contentIndex = event.contentIndex;
                const toolCallId = "call_" + Math.random().toString(36).substr(2, 9);
                const toolCallBlock = {
                  type: "toolCall",
                  id: toolCallId,
                  name: parsed.name,
                  arguments: parsed.arguments
                };
                
                // Emit the conversational text BEFORE the tool call if there is any
                let textBefore = buffer.substring(0, match ? match.index : 0)
                  .replace(/<think>[\s\S]*?<\/think>/gi, '')  // strip thinking blocks
                  .replace(/```(json)?\s*$/i, '')
                  .replace(/</think>\s*$/i, '')
                  .trim();
                if (textBefore.length > 0) {
                  // We need to keep this as a text block
                  event.partial.content[contentIndex] = { type: "text", text: textBefore } as any;
                  wrapper.push({ type: "text_start", contentIndex, partial: event.partial });
                  wrapper.push({ type: "text_delta", contentIndex, delta: textBefore, partial: event.partial });
                  wrapper.push({ type: "text_end", contentIndex, content: textBefore, partial: event.partial });
                  
                  // For the tool call, we need to append a NEW block to the content array
                  const newContentIndex = event.partial.content.length;
                  event.partial.content.push(toolCallBlock as any);
                  
                  wrapper.push({ type: "toolcall_start", contentIndex: newContentIndex, partial: event.partial });
                  wrapper.push({ type: "toolcall_delta", contentIndex: newContentIndex, delta: JSON.stringify(parsed.arguments), partial: event.partial });
                  wrapper.push({ type: "toolcall_end", contentIndex: newContentIndex, toolCall: toolCallBlock as any, partial: event.partial });
                } else {
                  // Replace text block with toolCall block entirely
                  event.partial.content[contentIndex] = toolCallBlock as any;
                  
                  wrapper.push({ type: "toolcall_start", contentIndex, partial: event.partial });
                  wrapper.push({ type: "toolcall_delta", contentIndex, delta: JSON.stringify(parsed.arguments), partial: event.partial });
                  wrapper.push({ type: "toolcall_end", contentIndex, toolCall: toolCallBlock as any, partial: event.partial });
                }
                
                isBuffering = false;
                bufferedEvents = [];
                continue; // Skip original text_end
              }
            } catch (e) {
              // Not a tool call, fall through and flush text
            }
            
            // Flush buffered text events
            isBuffering = false;
            for (const e of bufferedEvents) wrapper.push(e);
            bufferedEvents = [];
            wrapper.push(event);
          } else {
            wrapper.push(event);
          }
        } else {
          // Other events (e.g. done, toolcall_*, thinking_*)
          if (isBuffering) {
             // In case stream ends abruptly or transitions to another block type
             isBuffering = false;
             for (const e of bufferedEvents) wrapper.push(e);
             bufferedEvents = [];
          }
          
          if (event.type === "done") {
            // If it was a tool call, change reason from "stop" to "toolUse"
            const partial = event.message || event.partial;
            const hasToolCalls = partial?.content?.some((c: any) => c.type === "toolCall");
            if (hasToolCalls && event.reason === "stop") {
              event.reason = "toolUse" as any;
              if (event.message) event.message.stopReason = "toolUse";
            }
          }
          
          wrapper.push(event);
        }
      }
      wrapper.end();
    } catch (err) {
      wrapper.push({ type: "error", reason: "error" as any, error: {} as any });
      wrapper.end();
    }
  })();
  
  return wrapper;
}

export async function createRuntime(modelName: string): Promise<AgentSessionRuntime> {
  const cwd = process.env.WORK_DIR || process.cwd();
  
  const authStorage = AuthStorage.create();
  
  const modelRegistry = ModelRegistry.create(authStorage);
  
  // Register the custom provider to intercept the raw JSON stream from Ollama
  modelRegistry.registerProvider("ollama-qwen-fixed", {
    baseUrl: "http://localhost:11434/v1",
    apiKey: "ollama",
    api: "openai-completions",
    streamSimple: createQwenToolFixStream as any,
    models: [
      {
        id: modelName,
        name: `${modelName} (Ollama)`,
        reasoning: false,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 32000,
        compat: {
          supportsDeveloperRole: false,
          supportsReasoningEffort: false,
          thinkingFormat: "qwen-chat-template"
        }
      }
    ]
  });
  
  const model: Model<any> = modelRegistry.find("ollama-qwen-fixed", modelName)!;

  const runtimeFactory: CreateAgentSessionRuntimeFactory = async ({ cwd, sessionManager, sessionStartEvent }) => {
    const services = await createAgentSessionServices({ cwd });
    
    // Inject the dummy key directly into the newly created AuthStorage for THIS specific runtime pass
    services.authStorage.setRuntimeApiKey("ollama-qwen-fixed", "piwa-local-dummy-key");
    
    // Inject our custom model and settings into the session creation
    const sessionResult = await createAgentSessionFromServices({ 
      services, 
      sessionManager, 
      sessionStartEvent,
      model,
      tools: [
        ...createCodingTools(cwd),
        webSearchTool as any
      ]
    });

    return {
      ...sessionResult,
      services,
      diagnostics: services.diagnostics,
    };
  };

  return await createAgentSessionRuntime(runtimeFactory, {
    cwd,
    agentDir: getAgentDir(),
    sessionManager: SessionManager.inMemory(),
  });
}
