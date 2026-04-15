import { streamSimpleOpenAICompletions, createAssistantMessageEventStream } from "@mariozechner/pi-ai";
import { ModelRegistry, AuthStorage } from "@mariozechner/pi-coding-agent";

// Mock event types for reference
/*
  | { type: "text_start"; contentIndex: number; partial: AssistantMessage }
  | { type: "text_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: "text_end"; contentIndex: number; content: string; partial: AssistantMessage }
  | { type: "toolcall_start"; contentIndex: number; partial: AssistantMessage }
  | { type: "toolcall_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: "toolcall_end"; contentIndex: number; toolCall: ToolCall; partial: AssistantMessage }
*/

function createOllamaFixStream(model: any, context: any, options: any) {
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
            
            // If the buffer clearly doesn't look like JSON, flush it and stop buffering
            const trimmed = buffer.trimStart();
            if (trimmed.length > 0 && trimmed[0] !== '{') {
              isBuffering = false;
              for (const e of bufferedEvents) wrapper.push(e);
              bufferedEvents = [];
            }
          } else {
            wrapper.push(event);
          }
        } else if (event.type === "text_end") {
          if (isBuffering) {
            // Attempt to parse as tool call
            try {
              // Qwen sometimes outputs raw JSON
              const jsonStr = buffer.trim();
              const parsed = JSON.parse(jsonStr);
              
              if (parsed && typeof parsed.name === 'string' && typeof parsed.arguments === 'object') {
                console.log("[WRAPPER] Parsed tool call:", parsed.name);
                
                // Transform the partial content
                const contentIndex = event.contentIndex;
                const toolCallId = "call_" + Math.random().toString(36).substr(2, 9);
                const toolCallBlock = {
                  type: "toolCall",
                  id: toolCallId,
                  name: parsed.name,
                  arguments: parsed.arguments
                };
                
                // Replace text block with toolCall block
                event.partial.content[contentIndex] = toolCallBlock;
                
                wrapper.push({ type: "toolcall_start", contentIndex, partial: event.partial });
                wrapper.push({ type: "toolcall_delta", contentIndex, delta: JSON.stringify(parsed.arguments), partial: event.partial });
                wrapper.push({ type: "toolcall_end", contentIndex, toolCall: toolCallBlock as any, partial: event.partial });
                
                isBuffering = false;
                bufferedEvents = [];
                continue; // Skip text_end
              }
            } catch (e) {
              // Not a tool call, flush text
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
          // Other events
          if (isBuffering && event.type === "done") {
             // In case stream ends abruptly
             isBuffering = false;
             for (const e of bufferedEvents) wrapper.push(e);
             bufferedEvents = [];
          }
          
          if (event.type === "done") {
            // If it was a tool call, change reason from "stop" to "toolUse"
            const partial = event.message || event.partial;
            const hasToolCalls = partial?.content?.some((c: any) => c.type === "toolCall");
            if (hasToolCalls && event.reason === "stop") {
              event.reason = "toolUse";
              if (event.message) event.message.stopReason = "toolUse";
            }
          }
          
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
}
console.log("Wrapper parsed successfully");
