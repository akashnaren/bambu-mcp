#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { BambuLanClient } from "./client.js";
import { loadConfig } from "./config.js";
import { MockPrinter } from "./mock.js";
import { createServer } from "./server.js";
import { createSliceRunner } from "./slice.js";

async function main(): Promise<void> {
  const cfg = loadConfig();
  const port = cfg.mock ? new MockPrinter() : new BambuLanClient(cfg);
  const { server } = createServer(port, createSliceRunner(cfg.slicerBin));
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    `bambu-mcp ${cfg.mock ? "(mock)" : "LAN"} dialect=${cfg.model} host=${cfg.ip}`,
  );
}

main().catch((error) => {
  console.error("Fatal:", error instanceof Error ? error.message : error);
  process.exit(1);
});
