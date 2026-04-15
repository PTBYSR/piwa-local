import fetch from "node-fetch";

async function run() {
  const req = {
    model: "qwen2.5-coder:7b",
    messages: [
      { role: "system", content: "You are a helpful assistant." },
      { role: "user", content: "List the files in the current directory. You MUST output exactly <tool_call>\n{\"name\": \"bash\", \"arguments\": {\"command\": \"ls\"}}\n</tool_call>" }
    ],
    tools: [
      {
        type: "function",
        function: {
          name: "bash",
          description: "Run a bash command",
          parameters: {
            type: "object",
            properties: {
              command: { type: "string" }
            },
            required: ["command"]
          }
        }
      }
    ]
  };

  const res = await fetch("http://localhost:11434/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req)
  });
  
  const data = await res.json();
  console.log(JSON.stringify(data, null, 2));
}
run();
