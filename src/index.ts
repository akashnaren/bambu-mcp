#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { BambuLanClient } from "./client.js";
import { loadConfig } from "./config.js";
import { MockPrinter } from "./mock.js";
import { createTools } from "./tools.js";

async function main(): Promise<void> {
  const cfg = loadConfig();
  const port = cfg.mock ? new MockPrinter() : new BambuLanClient(cfg);
  const server = new McpServer({ name: "bambu-mcp", version: "0.1.0" });

  for (const tool of createTools(port, { safeMode: cfg.safeMode, slicerBin: cfg.slicerBin })) {
    server.tool(tool.name, tool.description, tool.inputSchema.shape, async (args) => {
      try {
        const result = await tool.handler(args ?? {});
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text" as const, text: `Error: ${message}` }],
          isError: true,
        };
      }
    });
  }

  await server.connect(new StdioServerTransport());
  console.error(
    `bambu-mcp ${cfg.mock ? "mock" : "lan"} model=${cfg.model} host=${cfg.ip} safeMode=${cfg.safeMode ? "on" : "off"}`,
  );
}

main().catch((error) => {
  console.error("Fatal:", error instanceof Error ? error.message : error);
  process.exit(1);
});
