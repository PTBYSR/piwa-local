import { AuthStorage, ModelRegistry, SessionManager, createAgentSessionFromServices, createAgentSessionRuntime, createAgentSessionServices, createCodingTools, getAgentDir, } from "@mariozechner/pi-coding-agent";
import { webSearchTool } from "./web-search.js";
export async function createRuntime(modelName) {
    const cwd = process.env.WORK_DIR || process.cwd();
    const authStorage = AuthStorage.create();
    const modelRegistry = ModelRegistry.create(authStorage);
    const model = {
        id: modelName,
        name: `${modelName} (Ollama)`,
        api: 'openai-completions',
        provider: 'ollama',
        baseUrl: 'http://localhost:11434/v1',
        reasoning: false,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 32000,
        compat: {
            // CRITICAL FIX: Ollama drops system prompts if sent as the 'developer' role.
            // This forces Pi to send the tool definitions using the standard 'system' role.
            supportsDeveloperRole: false,
            supportsReasoningEffort: false,
            // For Qwen specifically inside Ollama, this flag helps format the tool template
            thinkingFormat: "qwen-chat-template"
        }
    };
    const runtimeFactory = async ({ cwd, sessionManager, sessionStartEvent }) => {
        const services = await createAgentSessionServices({ cwd });
        // Inject the dummy key directly into the newly created AuthStorage for THIS specific runtime pass
        services.authStorage.setRuntimeApiKey("ollama", "piwa-local-dummy-key");
        // Inject a custom system prompt to force the local model to use native tool calling
        // instead of hallucinating Markdown JSON blocks into the chat.
        services.resourceLoader.getSystemPrompt = () => {
            return `You are an expert AI coding assistant. You are integrated with an execution environment and must use the provided tools to fulfill requests. Whenever you need to perform an action, use the corresponding tool call format natively. Do not explain the JSON structure, just execute the tool.`;
        };
        // Inject our custom model and settings into the session creation
        const sessionResult = await createAgentSessionFromServices({
            services,
            sessionManager,
            sessionStartEvent,
            model,
            tools: [
                ...createCodingTools(cwd),
                webSearchTool
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
