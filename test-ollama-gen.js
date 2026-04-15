import fetch from "node-fetch";

async function run() {
  const req = {
    model: "qwen2.5-coder:7b",
    prompt: "<|im_start|>system\nYou are a helpful assistant.\n# Tools\nYou may call one or more functions to assist with the user query.\n\nYou are provided with function signatures within <tools></tools>:\n<tools>\n{\"type\": \"function\", \"function\": {\"name\": \"bash\", \"description\": \"Run a bash command\", \"parameters\": {\"type\": \"object\", \"properties\": {\"command\": {\"type\": \"string\"}}, \"required\": [\"command\"]}}}\n</tools>\n\nFor each function call, return a json object with function name and arguments within <tool_call></tool_call> with NO other text. Do not include any backticks or ```json.\n<tool_call>\n{\"name\": <function-name>, \"arguments\": <args-json-object>}\n</tool_call><|im_end|>\n<|im_start|>user\nList the files in the current directory.<|im_end|>\n<|im_start|>assistant\n",
    raw: true,
    stream: false
  };

  const res = await fetch("http://localhost:11434/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req)
  });
  
  const data = await res.json();
  console.log(data.response);
}
run();
