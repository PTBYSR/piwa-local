import { createAssistantMessageEventStream, streamSimpleOpenAICompletions } from "@mariozechner/pi-ai";
import { ModelRegistry, AuthStorage } from "@mariozechner/pi-coding-agent";

const storage = AuthStorage.create();
const registry = ModelRegistry.inMemory(storage);

registry.registerProvider("ollama-fixed", {
  baseUrl: "http://localhost:11434/v1",
  apiKey: "ollama",
  api: "openai-completions",
  streamSimple: (model, context, options) => {
    // Call the exported OpenAI Completions stream function directly
    const originalStream = streamSimpleOpenAICompletions(model, context, options);
    
    const wrapper = createAssistantMessageEventStream();
    
    let isParsingTool = false;
    let toolCallBuffer = "";
    
    (async () => {
      try {
        for await (const event of originalStream) {
          if (event.type === "text_delta") {
            toolCallBuffer += event.delta;
            const text = event.partial.content[event.contentIndex] as any;
            const currentText = text.text || "";
            
            // Heuristic to detect Qwen raw JSON output
            if (currentText.trim().startsWith('{"name":') || currentText.trim().startsWith('{\n  "name":')) {
              isParsingTool = true;
            }
            
            if (!isParsingTool) {
              wrapper.push(event);
            }
          } else if (event.type === "text_end") {
            if (isParsingTool) {
              const text = event.partial.content[event.contentIndex] as any;
              const jsonStr = text.text.trim();
              try {
                const parsed = JSON.parse(jsonStr);
                if (parsed.name && parsed.arguments) {
                  console.log("\n[INTERCEPTED TOOL CALL]:", parsed);
                  
                  // Convert text block to toolCall block
                  event.partial.content[event.contentIndex] = {
                    type: "toolCall",
                    id: "call_" + Math.random().toString(36).substr(2, 9),
                    name: parsed.name,
                    arguments: parsed.arguments
                  };
                  
                  wrapper.push({
                    type: "toolcall_end",
                    contentIndex: event.contentIndex,
                    toolCall: event.partial.content[event.contentIndex] as any,
                    partial: event.partial
                  });
                  isParsingTool = false;
                  continue;
                }
              } catch (e) {
                // Ignore, push normal text end
              }
            }
            wrapper.push(event);
          } else {
            wrapper.push(event);
          }
        }
        wrapper.end();
      } catch (err) {
        wrapper.push({ type: "error", reason: "error", error: {} as any });
        wrapper.end();
      }
    })();
    
    return wrapper;
  },
  models: [
    {
      id: "qwen2.5-coder:7b",
      name: "Qwen2.5 Coder",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 32000,
      maxTokens: 4096
    }
  ]
});

async function run() {
  const model = registry.find("ollama-fixed", "qwen2.5-coder:7b");
  if (!model) throw new Error("Model not found");

  const stream = streamSimpleOpenAICompletions(model, {
    messages: [{ role: "user", content: "List files", timestamp: Date.now() }],
    tools: [
      {
        type: "function",
        function: {
          name: "bash",
          description: "Run a bash command",
          parameters: {
            type: "object",
            properties: { command: { type: "string" } },
            required: ["command"]
          }
        }
      }
    ] as any
  });
  
  console.log("Success");
}
run();
