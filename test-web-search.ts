import webSearchExt from './web-search.ts';

const mockPi = {
  registerTool: async (toolDef: any) => {
    console.log("Testing tool:", toolDef.name);
    console.log("----------------------------------------");
    try {
      const result = await toolDef.execute(
        "call_1", 
        { query: "pi coding agent github", limit: 3 }, 
        null, 
        (update: any) => console.log("Status:", update.content[0].text), 
        {}
      );
      console.log("\nSearch Results:");
      console.log("----------------------------------------");
      console.log(result.content[0].text);
    } catch (e) {
      console.error("Error occurred:", e);
    }
  }
};

// @ts-ignore
webSearchExt(mockPi);
