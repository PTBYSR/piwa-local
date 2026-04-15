import { streamSimple, createAssistantMessageEventStream } from "@mariozechner/pi-ai";
import { ModelRegistry, AuthStorage } from "@mariozechner/pi-coding-agent";

const storage = AuthStorage.create();
const registry = ModelRegistry.inMemory(storage);

registry.registerProvider("ollama-fixed", {
  baseUrl: "http://localhost:11434/v1",
  api: "openai-completions",
  streamSimple: (model, context, options) => {
    console.log("Custom stream executing!");
    // Call the original openai-completions implementation by using a standard provider name
    const originalModel = { ...model, provider: "openai" };
    const originalStream = streamSimple(originalModel, context, options);
    return originalStream;
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
    messages: [{ role: "user", content: "hi", timestamp: Date.now() }]
  });

  for await (const event of stream) {
    if (event.type === "text_delta") {
      process.stdout.write(event.delta);
    }
  }
}
run();
