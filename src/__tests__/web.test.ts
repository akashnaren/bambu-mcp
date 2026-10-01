import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { silenceLateMqttError, type LateMqttSocket } from "../client.js";
import { MockPrinter } from "../mock.js";
import { createTools, type Tool } from "../tools/index.js";
import { errorHint, fillMissingPrinterEnv, readLive, resolveStaticFile, runTool } from "../web.js";

describe("web tool runner", () => {
  it("turns the chamber light on while safe mode is on", async () => {
    const port = new MockPrinter();
    const outcome = await runTool(createTools(port, { safeMode: true }), "set_light", { on: true });

    expect(outcome.status).toBe(200);
    expect(outcome.body).toMatchObject({
      ok: true,
      result: { supported: true, on: true, led_node: "chamber_light" },
    });
    expect(port.commands).toEqual(["ledctrl:on"]);
  });

  it("does not register print, pause, or stop while safe mode is on", async () => {
    const port = new MockPrinter();
    const tools = createTools(port, { safeMode: true });

    for (const name of ["print", "pause", "stop"] as const) {
      const outcome = await runTool(tools, name, { confirm: true, file: "bracket-left-r1.gcode.3mf" });
      expect(outcome.status).toBe(404);
      expect(outcome.body.ok).toBe(false);
    }
    expect(port.commands).toEqual([]);
    expect(port.started).toHaveLength(0);
  });

  it("refuses motion without confirm when safe mode is off", async () => {
    const port = new MockPrinter();
    const tools = createTools(port, { safeMode: false });

    for (const name of ["print", "pause", "stop"] as const) {
      const outcome = await runTool(tools, name, { file: "bracket-left-r1.gcode.3mf" });
      expect(outcome.status).toBe(400);
      expect(outcome.body.ok).toBe(false);
      expect(String(outcome.body.error)).toMatch(/confirm/);
    }
    expect(port.commands).toEqual([]);
    expect(port.started).toHaveLength(0);
  });

  it("rejects an unknown tool name", async () => {
    const outcome = await runTool(createTools(new MockPrinter(), { safeMode: true }), "nope", {});
    expect(outcome.status).toBe(404);
    expect(outcome.body).toMatchObject({ ok: false });
  });

  it("maps an unreachable host to the local network hint", async () => {
    expect(errorHint("connect EHOSTUNREACH 10.0.0.183:8883")).toBe("localNetwork");
    expect(errorHint("ping: sendto: No route to host")).toBe("localNetwork");
    expect(errorHint("confirm-gated")).toBe(null);

    const tools: Tool[] = [
      {
        name: "status",
        gate: "read",
        description: "fail",
        inputSchema: z.object({}),
        handler: async () => {
          throw new Error("connect EHOSTUNREACH 10.0.0.183:8883");
        },
      },
    ];
    const outcome = await runTool(tools, "status", {});
    expect(outcome.status).toBe(400);
    expect(outcome.body).toMatchObject({ ok: false, hint: "localNetwork" });
  });

  it("fills only missing printer settings and leaves safe mode untouched", () => {
    const filled = fillMissingPrinterEnv(
      { BAMBU_SAFE_MODE: "1", BAMBU_IP: "" },
      JSON.stringify({
        mcpServers: {
          bambu: { env: { BAMBU_IP: "10.0.0.183", BAMBU_SAFE_MODE: "0", BAMBU_MODEL: "P2S" } },
        },
      }),
    );
    expect(filled.BAMBU_SAFE_MODE).toBe("1");
    expect(filled.BAMBU_IP).toBe("10.0.0.183");
    expect(filled.BAMBU_MODEL).toBe("P2S");
  });
});

describe("web live snapshot", () => {
  it("reads status, temps, and ams together", async () => {
    const live = await readLive(createTools(new MockPrinter(), { safeMode: true }));

    expect(live.status).toMatchObject({ state: "IDLE", safeMode: true });
    expect(live.temps).toMatchObject({ nozzleC: 25, bedC: 24 });
    expect(live.ams).toMatchObject({ units: [] });
    expect(live.statusError).toBeNull();
    expect(live.hint).toBeNull();
  });

  it("keeps temps and ams when status cannot reach the printer", async () => {
    const tools = createTools(new MockPrinter(), { safeMode: true }).map((tool) =>
      tool.name === "status"
        ? {
            ...tool,
            handler: async () => {
              throw new Error("connect EHOSTUNREACH 10.0.0.183:8883");
            },
          }
        : tool,
    );

    const live = await readLive(tools);

    expect(live.status).toBeNull();
    expect(live.statusError).toMatch(/EHOSTUNREACH/);
    expect(live.hint).toBe("localNetwork");
    expect(live.temps).toMatchObject({ nozzleC: 25 });
    expect(live.ams).toMatchObject({ units: [] });
  });
});

describe("web static files", () => {
  it("serves files inside assets and refuses paths that leave it", () => {
    const root = mkdtempSync(join(tmpdir(), "bambu-web-"));
    mkdirSync(join(root, "assets"));
    writeFileSync(join(root, "assets", "app.js"), "console.log(1)");
    writeFileSync(join(root, "secret.txt"), "nope");

    expect(resolveStaticFile(root, "/assets/app.js")).toBe(realpathSync(join(root, "assets", "app.js")));
    expect(resolveStaticFile(root, "/secret.txt")).toBeNull();
    expect(resolveStaticFile(root, "/assets/../secret.txt")).toBeNull();
    expect(resolveStaticFile(root, "/assets/%2e%2e/secret.txt")).toBeNull();
    expect(resolveStaticFile(root, "/assets/app.js.map")).toBeNull();
  });

  it("refuses a symlink that points outside assets", () => {
    const root = mkdtempSync(join(tmpdir(), "bambu-web-"));
    const outside = mkdtempSync(join(tmpdir(), "bambu-secret-"));
    mkdirSync(join(root, "assets"));
    writeFileSync(join(outside, "secret.js"), "nope");
    symlinkSync(join(outside, "secret.js"), join(root, "assets", "secret.js"));

    expect(resolveStaticFile(root, "/assets/secret.js")).toBeNull();
  });
});

describe("late mqtt error", () => {
  it("swallows an error emitted after listeners were removed", () => {
    const socket = new EventEmitter() as EventEmitter & LateMqttSocket & { ended: boolean };
    socket.ended = false;
    socket.end = (force: boolean) => {
      socket.ended = force;
    };

    silenceLateMqttError(socket);

    expect(() => socket.emit("error", new Error("connack timeout"))).not.toThrow();
    expect(socket.ended).toBe(true);
    expect(() => silenceLateMqttError(null)).not.toThrow();
  });
});
