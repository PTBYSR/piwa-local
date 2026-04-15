import { streamSimple, createAssistantMessageEventStream } from "@mariozechner/pi-ai";
import { ModelRegistry, AuthStorage } from "@mariozechner/pi-coding-agent";

const storage = AuthStorage.create();
const registry = ModelRegistry.inMemory(storage);

registry.registerProvider("ollama-fixed", {
  baseUrl: "http://localhost:11434/v1",
  apiKey: "ollama",
  api: "openai-completions",
  streamSimple: (model, context, options) => {
    // Call the original openai-completions implementation
    const originalModel = { ...model, provider: "openai" } as any;
    const originalStream = streamSimple(originalModel, context, options);
    
    const wrapper = createAssistantMessageEventStream();
    
    let isParsingTool = false;
    let toolCallBuffer = "";
    
    (async () => {
      try {
        for await (const event of originalStream) {
          if (event.type === "text_delta") {
            // Check if the text delta looks like a raw JSON tool call
            toolCallBuffer += event.delta;
            const text = event.partial.content[event.contentIndex] as any;
            
            // Very naive check for Qwen's raw JSON tool calls
            const currentText = text.text || "";
            if (currentText.trim().startsWith('{"name":') || currentText.trim().startsWith('{\n  "name":')) {
              // This looks like a tool call!
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
                  // We intercepted a tool call! Emit it as a toolcall instead!
                  // Note: this is a simplified simulation for the test
                  console.log("\n[INTERCEPTED TOOL CALL]:", parsed);
                  // We would emit toolcall_start, toolcall_delta, toolcall_end here
                  isParsingTool = false;
                  continue;
                }
              } catch (e) {
                // Not valid JSON, just pass the text
              }
            }
            wrapper.push(event);
          } else {
            wrapper.push(event);
          }
        }
        wrapper.end();
      } catch (err) {
        // Handle error
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

  const stream = streamSimple(model, {
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

  for await (const event of stream) {
    if (event.type === "text_delta" || event.type === "toolcall_delta") {
      process.stdout.write(event.delta || "");
    }
  }
}
run();
