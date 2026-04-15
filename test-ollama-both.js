import fetch from "node-fetch";

async function run() {
  const req = {
    model: "qwen2.5-coder:7b",
    messages: [
      { role: "system", content: "You MUST output tools using the exact format: <call:bash{\"command\":\"ls\"}>\nDo NOT use <tool_call> tags or anything else." },
      { role: "user", content: "List the files in the current directory." }
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
