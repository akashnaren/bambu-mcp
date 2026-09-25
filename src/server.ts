import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PrinterPort } from "./client.js";
import type { Capabilities } from "./models.js";
import { createTools } from "./tools.js";

/** Register tools. Does not open MQTT or FTPS. One server, one printer. */
export function createMcpServer(
  port: PrinterPort,
  options: { safeMode: boolean; slicerBin?: string; capabilities?: Capabilities },
): McpServer {
  const server = new McpServer({ name: "bambu-mcp", version: "0.1.0" });
  for (const tool of createTools(port, options)) {
    server.tool(tool.name, tool.description, tool.inputSchema.shape, async (args) => {
      try {
        const result = await tool.handler(args ?? {});
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { content: [{ type: "text" as const, text: `Error: ${message}` }], isError: true };
      }
    });
  }
  return server;
}
