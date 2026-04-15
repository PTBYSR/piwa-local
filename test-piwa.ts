import { createRuntime } from "./src/agent.js";

async function run() {
  const runtime = await createRuntime("qwen2.5-coder:7b");
  
  runtime.session.subscribe(async (event) => {
    if (event.type === "message_update") {
      if (event.assistantMessageEvent.type === "text_delta") {
        process.stdout.write(event.assistantMessageEvent.delta);
      }
    } else if (event.type === "tool_execution_start") {
      console.log(`\n\n[TOOL EXECUTING: ${event.toolName}]`);
    } else if (event.type === "turn_end") {
      console.log(`\n\n[TURN END]`);
    }
  });

  console.log("Sending prompt...");
  await runtime.session.prompt("Use the bash tool to run 'echo TEST'.");
}

run().catch(console.error);
