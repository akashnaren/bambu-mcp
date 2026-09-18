import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createTools, type RegisteredTool } from "./tools.js";
import type { PrinterPort, SliceRunner } from "./types.js";

export const SERVER_NAME = "bambu-mcp";
export const SERVER_VERSION = "0.1.0";

export function createServer(port: PrinterPort, slice?: SliceRunner): {
  server: McpServer;
  tools: RegisteredTool[];
} {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  const tools = createTools(port, slice);

  for (const tool of tools) {
    server.tool(
      tool.name,
      tool.description,
      tool.inputSchema.shape,
      async (args: Record<string, unknown>) => {
        try {
          const result = await tool.handler(args);
          return {
            content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return {
            content: [{ type: "text" as const, text: `Error: ${message}` }],
            isError: true,
          };
        }
      },
    );
  }

  return { server, tools };
}
