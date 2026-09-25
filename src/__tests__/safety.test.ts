import { describe, expect, it } from "vitest";
import { chamberLightFrom, chamberLightPayload } from "../client.js";
import { loadConfig } from "../config.js";
import { guardWrite, toolGate } from "../gates.js";
import { MockPrinter } from "../mock.js";
import { createTools } from "../tools.js";

const WRITES = ["upload", "print", "pause", "resume", "stop"] as const;

function tool(name: string, port = new MockPrinter(), safeMode?: boolean) {
  const found = createTools(port, safeMode === undefined ? undefined : { safeMode }).find(
    (entry) => entry.name === name,
  );
  if (!found) throw new Error(`missing tool ${name}`);
  return found;
}

describe("safe mode defaults on", () => {
  it("stays on unless BAMBU_SAFE_MODE is explicitly off", () => {
    expect(loadConfig({ BAMBU_MOCK: "1" }).safeMode).toBe(true);
    expect(loadConfig({ BAMBU_MOCK: "1", BAMBU_SAFE_MODE: "1" }).safeMode).toBe(true);
    expect(loadConfig({ BAMBU_MOCK: "1", BAMBU_SAFE_MODE: "maybe" }).safeMode).toBe(true);
    expect(loadConfig({ BAMBU_MOCK: "1", BAMBU_SAFE_MODE: "0" }).safeMode).toBe(false);
    expect(loadConfig({ BAMBU_MOCK: "1", BAMBU_MODEL: "P2S" }).model).toBe("P1S");
  });

  it("lets reads run and reports safeMode on status", async () => {
    await expect(tool("status").handler({})).resolves.toMatchObject({ state: "IDLE", safeMode: true });
    await expect(tool("temps").handler({})).resolves.toMatchObject({ nozzleC: 25 });
    await expect(tool("ams").handler({})).resolves.toMatchObject({ activeSlot: null });
    await expect(tool("list_files").handler({})).resolves.toMatchObject({
      files: ["bracket-left-r1.gcode.3mf"],
    });
  });

  it("omits gated writes from the safe-mode catalog and does not touch the printer", () => {
    const port = new MockPrinter();
    const names = createTools(port, { safeMode: true }).map((entry) => entry.name);

    for (const name of [...WRITES, "slice_hook"] as const) {
      expect(names).not.toContain(name);
      expect(() => guardWrite(name, true, true)).toThrow(/BAMBU_SAFE_MODE=0.*confirm: true.*explicit human ask/);
    }

    expect(port.started).toHaveLength(0);
    expect(port.commands).toEqual([]);
    expect(port.state).toBe("IDLE");
  });
});

describe("confirm gate when safe mode is off", () => {
  it("still refuses motion without confirm: true", async () => {
    const port = new MockPrinter();
    for (const name of ["print", "pause", "resume", "stop"] as const) {
      const args = name === "print" ? { file: "bracket-left-r1.gcode.3mf" } : {};
      await expect(tool(name, port, false).handler(args)).rejects.toThrow(/confirm-gated/);
    }
    expect(port.started).toHaveLength(0);
    expect(port.commands).toEqual([]);
    expect(port.state).toBe("IDLE");
  });

  it("prints only after confirm: true, and still refuses bad names", async () => {
    const port = new MockPrinter();
    const print = tool("print", port, false);
    await expect(
      print.handler({ file: "bracket-left-r1.gcode.3mf", confirm: true, alreadyUploaded: true }),
    ).resolves.toMatchObject({ printing: "bracket-left-r1.gcode.3mf", confirmed: true });
    expect(port.started).toHaveLength(1);
    expect(port.state).toBe("RUNNING");

    const refused = new MockPrinter();
    const blocked = tool("print", refused, false);
    await expect(blocked.handler({ file: "part.stl", confirm: true })).rejects.toThrow(/bare STL/);
    await expect(blocked.handler({ file: "wip-bracket-left-r1.gcode.3mf", confirm: true })).rejects.toThrow(
      /wip-\*/,
    );
    await expect(
      blocked.handler({ file: "scratch/bracket-left-r1.gcode.3mf", confirm: true }),
    ).rejects.toThrow(/scratch\//);
    expect(refused.started).toHaveLength(0);
  });

  it("runs pause when confirm is true", async () => {
    const port = new MockPrinter();
    await expect(tool("pause", port, false).handler({ confirm: true })).resolves.toMatchObject({
      ok: "paused",
      confirmed: true,
    });
    expect(port.commands).toEqual(["pause"]);
  });
});

describe("set_light stays allowed in safe mode", () => {
  it("keeps the safe-mode catalog at or under 10 and includes the demo tools", () => {
    // The host catalogs ~10 names. Refused tools stay unregistered in safe mode
    // so get_version, set_light, and set_camera are actually listed.
    const safeNames = createTools(new MockPrinter(), { safeMode: true }).map((entry) => entry.name);
    expect(safeNames.length).toBeLessThanOrEqual(10);
    expect(safeNames).toEqual([
      "status",
      "temps",
      "ams",
      "list_files",
      "get_version",
      "set_light",
      "set_camera",
      "set_sound",
    ]);
    for (const name of ["slice_hook", "upload", "print", "pause", "resume", "stop"] as const) {
      expect(safeNames).not.toContain(name);
    }

    const openNames = createTools(new MockPrinter(), { safeMode: false }).map((entry) => entry.name);
    for (const name of [
      "get_version",
      "set_light",
      "set_camera",
      "set_sound",
      "upload",
      "slice_hook",
      "print",
      "pause",
      "resume",
      "stop",
    ] as const) {
      expect(openNames).toContain(name);
    }
  });

  it("classifies chamber light as a low-risk write, not motion", () => {
    expect(toolGate("set_light")).toBe("safe_write_low_risk");
    expect(toolGate("print")).toBe("motion");
    expect(toolGate("pause")).toBe("motion");
    expect(toolGate("resume")).toBe("motion");
    expect(toolGate("stop")).toBe("motion");
    expect(toolGate("set_camera")).toBe("safe_write_low_risk");
    expect(toolGate("set_sound")).toBe("safe_write_low_risk");
    expect(toolGate("upload")).toBe("write");
    expect(toolGate("get_version")).toBe("read");
    expect(toolGate("status")).toBe("read");
  });

  it("sends ledctrl timing fields for on and off", () => {
    expect(chamberLightPayload(true, "7")).toEqual({
      system: {
        sequence_id: "7",
        command: "ledctrl",
        led_node: "chamber_light",
        led_mode: "on",
        led_on_time: 500,
        led_off_time: 500,
        loop_times: 1,
        interval_time: 1000,
      },
    });
    expect(chamberLightPayload(false, "8")).toMatchObject({
      system: { command: "ledctrl", led_node: "chamber_light", led_mode: "off", led_on_time: 500 },
    });
  });

  it("turns the chamber light on and off while safe mode is on, without confirm", async () => {
    const port = new MockPrinter();
    const setLight = tool("set_light", port);

    await expect(setLight.handler({ on: true })).resolves.toMatchObject({
      on: true,
      led_node: "chamber_light",
    });
    await expect(setLight.handler({ on: false })).resolves.toMatchObject({
      on: false,
      led_node: "chamber_light",
    });

    expect(port.commands).toEqual(["ledctrl:on", "ledctrl:off"]);
    expect(port.chamberLight).toBe("off");
    expect(port.started).toHaveLength(0);
    expect(port.state).toBe("IDLE");

    await expect(tool("status", port).handler({})).resolves.toMatchObject({
      chamberLight: "off",
      safeMode: true,
    });
    expect(createTools(port, { safeMode: true }).some((entry) => entry.name === "print")).toBe(false);
    expect(() => guardWrite("print", true, true)).toThrow(/BAMBU_SAFE_MODE/);
    expect(port.started).toHaveLength(0);
  });

  it("reads chamber light from lights_report and ignores other nodes", () => {
    expect(
      chamberLightFrom({
        lights_report: [
          { mode: "on", node: "chamber_light" },
          { mode: "flashing", node: "work_light" },
        ],
      }),
    ).toBe("on");
    expect(chamberLightFrom({})).toBe(null);
  });

  it("does not ask for confirm when safe mode is off", async () => {
    const port = new MockPrinter();
    await expect(tool("set_light", port, false).handler({ on: true })).resolves.toMatchObject({ on: true });
    expect(port.commands).toEqual(["ledctrl:on"]);
    expect(port.chamberLight).toBe("on");
  });
});
