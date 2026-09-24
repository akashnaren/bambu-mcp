import { describe, expect, it } from "vitest";
import { MockPrinter } from "../mock.js";
import { createServer, SERVER_NAME } from "../server.js";

describe("MCP server", () => {
  it("registers tools on an MCP server instance", () => {
    const { server, tools } = createServer(new MockPrinter());
    expect(SERVER_NAME).toBe("bambu-mcp");
    expect(server).toBeTruthy();
    expect(tools).toHaveLength(11);
    expect(tools.map((tool) => tool.name)).toContain("capabilities");
  });

  it("defaults registered handlers to safe mode", async () => {
    const { tools } = createServer(new MockPrinter());
    const status = tools.find((tool) => tool.name === "status");
    const print = tools.find((tool) => tool.name === "print");
    await expect(status?.handler({})).resolves.toMatchObject({ safeMode: true });
    await expect(
      print?.handler({ file: "bracket-left-r1.gcode.3mf", confirm: true }),
    ).rejects.toThrow(/BAMBU_SAFE_MODE=0/);
  });

  it("still requires confirm when safe mode is turned off", async () => {
    const port = new MockPrinter();
    const { tools } = createServer(port, undefined, { safeMode: false });
    const print = tools.find((tool) => tool.name === "print");
    await expect(print?.handler({ file: "bracket-left-r1.gcode.3mf" })).rejects.toThrow(
      /confirm-gated/,
    );
    expect(port.started).toHaveLength(0);
  });
});
