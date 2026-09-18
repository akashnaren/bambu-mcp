import { describe, expect, it } from "vitest";
import { MockPrinter } from "../mock.js";
import { createServer, SERVER_NAME } from "../server.js";

describe("MCP server", () => {
  it("registers tools on an MCP server instance", () => {
    const { server, tools } = createServer(new MockPrinter());
    expect(SERVER_NAME).toBe("bambu-mcp");
    expect(server).toBeTruthy();
    expect(tools).toHaveLength(10);
  });
});
