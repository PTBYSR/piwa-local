import { Type } from "@sinclair/typebox";
import { defineTool } from "@mariozechner/pi-coding-agent";
export const webSearchTool = defineTool({
    name: "web_search",
    label: "Web Search",
    description: "Search the web using a keyless DuckDuckGo scraper. Returns top results with titles, snippets, and URLs.",
    promptSnippet: "Search the web for current information, documentation, and news.",
    promptGuidelines: [
        "Use the web_search tool to find up-to-date information when you don't know the answer.",
        "Keep search queries concise and keyword-focused."
    ],
    parameters: Type.Object({
        query: Type.String({ description: "The search query" }),
        limit: Type.Optional(Type.Number({ description: "Max results (default 5)" }))
    }),
    async execute(_toolCallId, params, signal, onUpdate, _ctx) {
        const limit = params.limit || 5;
        // Update the UI while we fetch
        onUpdate?.({
            content: [{ type: "text", text: `Searching DuckDuckGo for: "${params.query}"...` }]
        });
        try {
            // We use html.duckduckgo.com which serves plain HTML, avoiding complex JS rendering
            const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(params.query)}`, {
                signal,
                headers: {
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
                    "Accept-Language": "en-US,en;q=0.5"
                }
            });
            if (!res.ok) {
                throw new Error(`Search request failed with status ${res.status}`);
            }
            const html = await res.text();
            // Basic check to see if DDG triggered a bot-protection captcha
            if (html.includes("browser") && html.includes("redirect")) {
                throw new Error("DuckDuckGo blocked the request (bot detection). Try again later or use a different network.");
            }
            const results = [];
            // Split HTML by result blocks to parse them manually
            const resultBlocks = html.split('class="result ');
            for (let i = 1; i < resultBlocks.length && results.length < limit; i++) {
                const block = resultBlocks[i];
                // Regex extraction for URL, Title, and Snippet
                const urlMatch = block.match(/href="([^"]+)"/);
                const titleMatch = block.match(/<h2 class="result__title">[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/);
                const snippetMatch = block.match(/<a class="result__snippet[^>]*>([\s\S]*?)<\/a>/);
                if (urlMatch && titleMatch) {
                    // Helper to clean HTML tags and decode basic entities
                    const cleanText = (str) => {
                        return str
                            .replace(/<[^>]+>/g, '')
                            .replace(/&quot;/g, '"')
                            .replace(/&amp;/g, '&')
                            .replace(/&#39;/g, "'")
                            .replace(/&lt;/g, '<')
                            .replace(/&gt;/g, '>')
                            .replace(/\s+/g, ' ')
                            .trim();
                    };
                    let url = urlMatch[1];
                    // DDG sometimes obfuscates external URLs via a redirect endpoint
                    if (url.includes('uddg=')) {
                        try {
                            const urlParams = new URLSearchParams(url.split('?')[1]);
                            const uddg = urlParams.get('uddg');
                            if (uddg)
                                url = decodeURIComponent(uddg);
                        }
                        catch (e) {
                            // ignore URL parsing errors, fallback to raw
                        }
                    }
                    else if (url.startsWith('//')) {
                        url = 'https:' + url;
                    }
                    results.push({
                        title: cleanText(titleMatch[1]),
                        url: url,
                        snippet: snippetMatch ? cleanText(snippetMatch[1]) : ""
                    });
                }
            }
            if (results.length === 0) {
                return {
                    content: [{ type: "text", text: `No results found for "${params.query}".` }],
                    details: { results: [] }
                };
            }
            // Format for the LLM context
            let resultText = `Found ${results.length} results for "${params.query}":\n\n`;
            results.forEach((r, idx) => {
                resultText += `${idx + 1}. **${r.title}**\n`;
                resultText += `   URL: ${r.url}\n`;
                resultText += `   Snippet: ${r.snippet}\n\n`;
            });
            return {
                content: [{ type: "text", text: resultText }],
                details: { results } // Store raw data in details for rendering/state tracking
            };
        }
        catch (error) {
            // Throwing signals a tool error natively to the LLM
            throw new Error(`Web search failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
});
