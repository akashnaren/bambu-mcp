import { describe, expect, it } from "vitest";
import { buildSlicerArgs, CliSliceRunner, resolveSlicerBin } from "../slice.js";

describe("slicer CLI (community Orca/Bambu flags)", () => {
  it("honors SLICER_BIN / explicit override", () => {
    expect(resolveSlicerBin("/opt/orca-slicer")).toBe("/opt/orca-slicer");
  });

  it("builds PrusaSlicer-fork slice flags", () => {
    expect(
      buildSlicerArgs({
        inputPath: "/tmp/part.stl",
        outputPath: "/tmp/clip-v1-r1.gcode.3mf",
        plate: 0,
        settings: "printer.json;process.json",
        filaments: "pla.json",
        arrange: true,
        orient: false,
      }),
    ).toEqual([
      "--slice",
      "0",
      "--load-settings",
      "printer.json;process.json",
      "--load-filaments",
      "pla.json",
      "--arrange",
      "1",
      "--orient",
      "0",
      "--export-3mf",
      "/tmp/clip-v1-r1.gcode.3mf",
      "/tmp/part.stl",
    ]);
  });

  it("throws when no slicer is configured", () => {
    const prev = process.env.PATH;
    process.env.PATH = "";
    try {
      expect(() => resolveSlicerBin()).toThrow(/No slicer found/);
    } finally {
      process.env.PATH = prev;
    }
  });
});

describe("CliSliceRunner", () => {
  it("rejects a failing slicer process", async () => {
    const runner = new CliSliceRunner("/opt/orca-slicer", async () => {
      throw new Error("Slice failed (exit 1). boom");
    });
    await expect(
      runner.run({
        inputPath: "/tmp/a.stl",
        outputPath: "/tmp/a-b-r1.gcode.3mf",
        plate: 0,
        arrange: true,
        orient: true,
      }),
    ).rejects.toThrow(/Slice failed/);
  });

  it("returns the export path on success", async () => {
    const runner = new CliSliceRunner("/opt/orca-slicer", async () => "ok");
    await expect(
      runner.run({
        inputPath: "/tmp/a.stl",
        outputPath: "/tmp/clip-v1-r1.gcode.3mf",
        plate: 0,
        arrange: true,
        orient: true,
      }),
    ).resolves.toMatchObject({ output: "/tmp/clip-v1-r1.gcode.3mf" });
  });
});
