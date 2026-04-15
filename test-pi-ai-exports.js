import * as piAi from "@mariozechner/pi-ai";
console.log(Object.keys(piAi).filter(k => k.includes("stream") || k.includes("Provider")));
