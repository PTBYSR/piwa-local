import fetch from "node-fetch";

async function run() {
  const req = {
    model: "qwen2.5-coder:7b",
    messages: [
      { role: "system", content: `You are an expert AI coding assistant. You are integrated with an execution environment and must use the provided tools to fulfill requests.

Available tools:
- bash: Run a bash command

IMPORTANT: You must use the tools by outputting the exact format below in your text.
In order to issue a single function call use the format:
<call:tool_name{"arg1": "value"}>

Example:
<call:bash{"command": "ls -la"}>
` },
      { role: "user", content: "List the files in the current directory." }
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
