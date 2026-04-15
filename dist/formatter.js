export function format(raw) {
    // Strip out markdown code blocks that are exactly JSON tool calls
    // This happens when Ollama (which lacks native tool calling) hallucinate tools as markdown JSON
    let text = raw.replace(/```json\s*\{\s*"name":\s*"[^"]+",\s*"arguments":\s*\{[\s\S]*?\}\s*\}\s*```/g, '');
    // 1. Strip markdown headers
    text = text.replace(/^#+\s+(.*)$/gm, '$1');
    // 2. Preserve code blocks as-is (Nothing to do, WhatsApp handles ```)
    // 3. Convert **bold** to *bold*
    text = text.replace(/\*\*([^*]+)\*\*/g, '*$1*');
    // 4. Trim excessive blank lines (max 2 consecutive newlines)
    text = text.replace(/\n{3,}/g, '\n\n');
    return text.trim();
}
