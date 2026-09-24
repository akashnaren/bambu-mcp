#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { BambuLanClient } from "./client.js";
import { loadConfig } from "./config.js";
import { MockPrinter } from "./mock.js";
import { createMcpServer } from "./server.js";

async function main(): Promise<void> {
  const cfg = loadConfig();
  const port = cfg.mock ? new MockPrinter() : new BambuLanClient(cfg);
  const server = createMcpServer(port, { safeMode: cfg.safeMode, slicerBin: cfg.slicerBin });
  await server.connect(new StdioServerTransport());
  console.error(
    `bambu-mcp ${cfg.mock ? "mock" : "lan"} model=${cfg.model} host=${cfg.ip} safeMode=${cfg.safeMode ? "on" : "off"}`,
  );
}

main().catch((error) => {
  console.error("Fatal:", error instanceof Error ? error.message : error);
  process.exit(1);
});
