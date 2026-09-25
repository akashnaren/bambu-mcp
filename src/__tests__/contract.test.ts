import { describe, expect, it } from "vitest";
import {
  assertPrintableArtifact,
  formatPrintableName,
  parseSidecar,
} from "../contract.js";

describe("printable names", () => {
  it("builds and accepts {part}-{variant}-{rev}.gcode.3mf", () => {
    expect(formatPrintableName("hose_clamp", "left", "r3")).toBe("hose_clamp-left-r3.gcode.3mf");
    expect(assertPrintableArtifact("plates/hose_clamp-left-r3.gcode.3mf")).toEqual({
      part: "hose_clamp",
      variant: "left",
      rev: "r3",
      filename: "hose_clamp-left-r3.gcode.3mf",
    });
  });

  it("names the slice_hook tool when the file is not sliced", () => {
    expect(() => assertPrintableArtifact("clip.stl")).toThrow(/slice_hook/);
    expect(() => assertPrintableArtifact("clip.3mf")).toThrow(/slice_hook/);
    expect(() => assertPrintableArtifact("wip-hose_clamp-left-r3.gcode.3mf")).toThrow(/wip-\*/);
    expect(() => assertPrintableArtifact("scratch/hose_clamp-left-r3.gcode.3mf")).toThrow(/scratch\//);
  });

  it("rejects name parts that break the pattern", () => {
    expect(() => formatPrintableName("bad part", "left", "r1")).toThrow(/Invalid printable name/);
    expect(() => formatPrintableName("_clip", "left", "r1")).toThrow(/Invalid printable name/);
  });
});

describe("print.json", () => {
  it("keeps plate, AMS, and calibration fields", () => {
    expect(
      parseSidecar({
        plate: 2,
        useAms: false,
        amsMapping: [1, 0],
        bedType: "textured_pei_plate",
        timelapse: true,
        flowCali: false,
        bedLeveling: false,
        vibrationCali: false,
        layerInspect: true,
        part: "hose_clamp",
        variant: "left",
        rev: "r3",
      }),
    ).toEqual({
      plate: 2,
      useAms: false,
      amsMapping: [1, 0],
      bedType: "textured_pei_plate",
      timelapse: true,
      flowCali: false,
      bedLeveling: false,
      vibrationCali: false,
      layerInspect: true,
    });
  });

  it("rejects a non-object and a bad plate", () => {
    expect(() => parseSidecar([])).toThrow(/JSON object/);
    expect(() => parseSidecar({ plate: 0 })).toThrow(/positive integer/);
    expect(() => parseSidecar({ bedType: 1 })).toThrow(/bedType/);
  });
});
