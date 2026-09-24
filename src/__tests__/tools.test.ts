import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MockPrinter } from "../mock.js";
import { createTools } from "../tools.js";
import type { SliceRequest, SliceRunner } from "../types.js";

const mockSlice: SliceRunner = {
  async run(request: SliceRequest) {
    return { output: request.outputPath, cmd: `mock-slicer ${request.inputPath}` };
  },
};

/** Existing write-path tests opt out. The default (omitted) is safe mode on. */
const unlocked = { safeMode: false } as const;

function find(name: string, options?: { safeMode?: boolean }) {
  const tools = createTools(new MockPrinter(), mockSlice, options);
  const tool = tools.find((entry) => entry.name === name);
  if (!tool) throw new Error(`missing tool ${name}`);
  return tool;
}

describe("tool catalog", () => {
  it("exports the Imagine LAN surface", () => {
    const names = createTools(new MockPrinter()).map((tool) => tool.name);
    expect(names).toEqual([
      "status",
      "temps",
      "ams",
      "list_files",
      "capabilities",
      "upload",
      "print",
      "pause",
      "resume",
      "stop",
      "slice_hook",
    ]);
  });
});

describe("read tools (mocked printer)", () => {
  it("status / temps / ams / list_files / capabilities do not need confirm", async () => {
    await expect(find("status").handler({})).resolves.toMatchObject({
      state: "IDLE",
      safeMode: true,
    });
    await expect(find("temps").handler({})).resolves.toMatchObject({ nozzleC: 25 });
    await expect(find("ams").handler({})).resolves.toMatchObject({ activeSlot: 0 });
    await expect(find("list_files").handler({})).resolves.toMatchObject({
      files: ["bracket-left-r1.gcode.3mf"],
    });
    await expect(find("capabilities").handler({})).resolves.toMatchObject({
      safeMode: true,
      reads: ["status", "temps", "ams", "list_files", "capabilities"],
      writes: ["upload", "print", "pause", "resume", "stop", "slice_hook"],
      confirmRequired: ["print", "pause", "resume", "stop"],
    });
  });
});

describe("safe mode (default on)", () => {
  it("blocks writes even when confirm is true, and does not touch the printer", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bambu-mcp-"));
    const file = join(dir, "clip-v1-r2.gcode.3mf");
    writeFileSync(file, "3mf-bytes");
    const input = join(dir, "raw.stl");
    writeFileSync(input, "solid");

    const port = new MockPrinter();
    const calls: SliceRequest[] = [];
    const tools = createTools(port, {
      async run(request) {
        calls.push(request);
        return { output: request.outputPath, cmd: "slicer" };
      },
    });
    const args: Record<string, Record<string, unknown>> = {
      upload: { localPath: file },
      print: { file, confirm: true },
      pause: { confirm: true },
      resume: { confirm: true },
      stop: { confirm: true },
      slice_hook: {
        inputPath: input,
        part: "clip",
        variant: "v1",
        rev: "r2",
        outputDir: dir,
        settings: "printer.json;process.json",
      },
    };

    for (const name of ["upload", "print", "pause", "resume", "stop", "slice_hook"]) {
      const tool = tools.find((entry) => entry.name === name);
      await expect(tool?.handler(args[name] ?? {})).rejects.toThrow(/BAMBU_SAFE_MODE=0/);
      await expect(tool?.handler(args[name] ?? {})).rejects.toThrow(/confirm: true/);
      await expect(tool?.handler(args[name] ?? {})).rejects.toThrow(/explicit human ask/);
    }

    expect(port.started).toHaveLength(0);
    expect(port.commands).toEqual([]);
    expect(port.printState).toBe("IDLE");
    expect(port.files.has("clip-v1-r2.gcode.3mf")).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("reports safeMode false from status and capabilities once unlocked", async () => {
    await expect(find("status", unlocked).handler({})).resolves.toMatchObject({
      safeMode: false,
    });
    await expect(find("capabilities", unlocked).handler({})).resolves.toMatchObject({
      safeMode: false,
      confirmRequired: ["print", "pause", "resume", "stop"],
    });
  });
});

describe("print safety", () => {
  it("refuses print without confirm when safe mode is off", async () => {
    const port = new MockPrinter();
    const print = createTools(port, undefined, unlocked).find((tool) => tool.name === "print")!;
    await expect(print.handler({ file: "bracket-left-r1.gcode.3mf" })).rejects.toThrow(
      /confirm-gated/,
    );
    await expect(
      print.handler({ file: "bracket-left-r1.gcode.3mf", confirm: false }),
    ).rejects.toThrow(/confirm-gated/);
    expect(port.started).toHaveLength(0);
    expect(port.printState).toBe("IDLE");
  });

  it("refuses bare STL / wip / scratch even with confirm", async () => {
    await expect(
      find("print", unlocked).handler({ file: "part.stl", confirm: true }),
    ).rejects.toThrow(/bare STL/);
    await expect(
      find("print", unlocked).handler({ file: "wip-bracket-left-r1.gcode.3mf", confirm: true }),
    ).rejects.toThrow(/wip-\*/);
    await expect(
      find("print", unlocked).handler({
        file: "scratch/bracket-left-r1.gcode.3mf",
        confirm: true,
      }),
    ).rejects.toThrow(/scratch\//);
  });

  it("prints a contract artifact after confirm and records the MQTT-style start", async () => {
    const port = new MockPrinter();
    const print = createTools(port, undefined, unlocked).find((tool) => tool.name === "print")!;
    const result = await print.handler({
      file: "bracket-left-r1.gcode.3mf",
      confirm: true,
      alreadyUploaded: true,
    });
    expect(result).toMatchObject({
      printing: "bracket-left-r1.gcode.3mf",
      confirmed: true,
      plate: 1,
    });
    expect(port.started[0]?.remoteName).toBe("bracket-left-r1.gcode.3mf");
    expect(port.printState).toBe("RUNNING");
  });

  it("uploads a local artifact then starts print", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bambu-mcp-"));
    const file = join(dir, "clip-v1-r2.gcode.3mf");
    writeFileSync(file, "3mf-bytes");
    writeFileSync(
      join(dir, "clip-v1-r2.print.json"),
      JSON.stringify({ plate: 2, amsMapping: [3] }),
    );
    const port = new MockPrinter();
    const print = createTools(port, undefined, unlocked).find((tool) => tool.name === "print")!;
    const result = (await print.handler({ file, confirm: true })) as {
      plate: number;
      amsMapping: number[];
    };
    expect(result.plate).toBe(2);
    expect(result.amsMapping).toEqual([3]);
    expect(port.files.has("clip-v1-r2.gcode.3mf")).toBe(true);
  });

  it("gates pause / resume / stop", async () => {
    await expect(find("pause", unlocked).handler({})).rejects.toThrow(/confirm-gated/);
    await expect(find("resume", unlocked).handler({ confirm: true })).resolves.toMatchObject({
      ok: "resumed",
    });
    await expect(find("stop", unlocked).handler({ confirm: true })).resolves.toMatchObject({
      ok: "stopped",
    });
  });
});

describe("upload", () => {
  it("rejects a non-contract local file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bambu-mcp-"));
    const file = join(dir, "mesh.stl");
    writeFileSync(file, "solid");
    await expect(find("upload", unlocked).handler({ localPath: file })).rejects.toThrow(/bare STL/);
  });
});

describe("slice_hook", () => {
  it("writes a contract output name and does not print", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bambu-mcp-"));
    const input = join(dir, "raw.stl");
    writeFileSync(input, "solid");
    const port = new MockPrinter();
    const calls: SliceRequest[] = [];
    const runner: SliceRunner = {
      async run(request) {
        calls.push(request);
        return { output: request.outputPath, cmd: "slicer" };
      },
    };
    const hook = createTools(port, runner, unlocked).find((tool) => tool.name === "slice_hook")!;
    const result = await hook.handler({
      inputPath: input,
      part: "clip",
      variant: "v1",
      rev: "r2",
      outputDir: dir,
      settings: "printer.json;process.json",
    });
    expect(result).toMatchObject({ artifact: "clip-v1-r2.gcode.3mf" });
    expect(calls[0]?.outputPath).toBe(join(dir, "clip-v1-r2.gcode.3mf"));
    expect(port.started).toHaveLength(0);
  });

  it("requires presets for a bare STL", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bambu-mcp-"));
    const input = join(dir, "raw.stl");
    writeFileSync(input, "solid");
    await expect(
      find("slice_hook", unlocked).handler({
        inputPath: input,
        part: "clip",
        variant: "v1",
        rev: "r2",
      }),
    ).rejects.toThrow(/presets/);
  });
});
