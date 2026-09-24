import { describe, expect, it } from "vitest";
import { loadConfig } from "../config.js";
import { MockPrinter } from "../mock.js";
import { createTools } from "../tools.js";

const WRITES = ["upload", "print", "pause", "resume", "stop", "slice_hook"] as const;

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

  it("blocks every write even when confirm is true, and does not touch the printer", async () => {
    const port = new MockPrinter();
    const args: Record<string, Record<string, unknown>> = {
      upload: { localPath: "clip-v1-r1.gcode.3mf" },
      print: { file: "bracket-left-r1.gcode.3mf", confirm: true },
      pause: { confirm: true },
      resume: { confirm: true },
      stop: { confirm: true },
      slice_hook: { inputPath: "raw.stl", part: "clip", variant: "v1", rev: "r1", settings: "a;b" },
    };

    for (const name of WRITES) {
      await expect(tool(name, port).handler(args[name])).rejects.toThrow(
        /BAMBU_SAFE_MODE=0.*confirm: true.*explicit human ask/,
      );
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
