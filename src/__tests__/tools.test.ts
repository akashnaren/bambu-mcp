import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MockPrinter } from "../mock.js";
import { createTools } from "../tools.js";
import type { SliceRequest, SliceRunner } from "../types.js";

function find(name: string) {
  const tools = createTools(new MockPrinter(), {
    async run(request: SliceRequest) {
      return { output: request.outputPath, cmd: `mock-slicer ${request.inputPath}` };
    },
  });
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
  it("status / temps / ams / list_files do not need confirm", async () => {
    await expect(find("status").handler({})).resolves.toMatchObject({ state: "IDLE" });
    await expect(find("temps").handler({})).resolves.toMatchObject({ nozzleC: 25 });
    await expect(find("ams").handler({})).resolves.toMatchObject({ activeSlot: 0 });
    await expect(find("list_files").handler({})).resolves.toMatchObject({
      files: ["bracket-left-r1.gcode.3mf"],
    });
  });
});

describe("print safety", () => {
  it("refuses print without confirm", async () => {
    await expect(
      find("print").handler({ file: "bracket-left-r1.gcode.3mf" }),
    ).rejects.toThrow(/confirm-gated/);
  });

  it("refuses bare STL / wip / scratch even with confirm", async () => {
    await expect(
      find("print").handler({ file: "part.stl", confirm: true }),
    ).rejects.toThrow(/bare STL/);
    await expect(
      find("print").handler({ file: "wip-bracket-left-r1.gcode.3mf", confirm: true }),
    ).rejects.toThrow(/wip-\*/);
    await expect(
      find("print").handler({
        file: "scratch/bracket-left-r1.gcode.3mf",
        confirm: true,
      }),
    ).rejects.toThrow(/scratch\//);
  });

  it("prints a contract artifact after confirm and records the MQTT-style start", async () => {
    const port = new MockPrinter();
    const print = createTools(port).find((tool) => tool.name === "print")!;
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
    const print = createTools(port).find((tool) => tool.name === "print")!;
    const result = (await print.handler({ file, confirm: true })) as {
      plate: number;
      amsMapping: number[];
    };
    expect(result.plate).toBe(2);
    expect(result.amsMapping).toEqual([3]);
    expect(port.files.has("clip-v1-r2.gcode.3mf")).toBe(true);
  });

  it("gates pause / resume / stop", async () => {
    await expect(find("pause").handler({})).rejects.toThrow(/confirm-gated/);
    await expect(find("resume").handler({ confirm: true })).resolves.toMatchObject({
      ok: "resumed",
    });
    await expect(find("stop").handler({ confirm: true })).resolves.toMatchObject({
      ok: "stopped",
    });
  });
});

describe("upload", () => {
  it("rejects a non-contract local file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bambu-mcp-"));
    const file = join(dir, "mesh.stl");
    writeFileSync(file, "solid");
    await expect(find("upload").handler({ localPath: file })).rejects.toThrow(/bare STL/);
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
    const hook = createTools(port, runner).find((tool) => tool.name === "slice_hook")!;
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
      find("slice_hook").handler({
        inputPath: input,
        part: "clip",
        variant: "v1",
        rev: "r2",
      }),
    ).rejects.toThrow(/presets/);
  });
});
