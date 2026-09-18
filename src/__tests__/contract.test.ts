import { describe, expect, it } from "vitest";
import {
  assertPrintableArtifact,
  defaultPrintOptions,
  formatPrintableName,
  isBareStl,
  isMeshOnly3mf,
  isScratchPath,
  isWipName,
  parsePrintableName,
  parseSidecar,
  sidecarPathFor,
} from "../contract.js";

describe("Imagine printable name", () => {
  it("parses {part}-{variant}-{rev}.gcode.3mf", () => {
    expect(parsePrintableName("bracket-left-r3.gcode.3mf")).toEqual({
      part: "bracket",
      variant: "left",
      rev: "r3",
      filename: "bracket-left-r3.gcode.3mf",
    });
  });

  it("accepts underscores in segments", () => {
    expect(parsePrintableName("hose_clamp-v2-r1.gcode.3mf")?.part).toBe("hose_clamp");
  });

  it("rejects mesh-only 3mf and random names", () => {
    expect(parsePrintableName("bracket-left-r3.3mf")).toBeNull();
    expect(parsePrintableName("model.gcode.3mf")).toBeNull();
    expect(isMeshOnly3mf("part.3mf")).toBe(true);
    expect(isMeshOnly3mf("part-a-r1.gcode.3mf")).toBe(false);
  });

  it("formats a valid name and rejects empty segments", () => {
    expect(formatPrintableName("clip", "v1", "r2")).toBe("clip-v1-r2.gcode.3mf");
    expect(() => formatPrintableName("", "v1", "r2")).toThrow(/Invalid Imagine name/);
  });
});

describe("start-print refuse list", () => {
  it("refuses bare STL", () => {
    expect(isBareStl("parts/clip.stl")).toBe(true);
    expect(() => assertPrintableArtifact("clip.stl")).toThrow(/bare STL/);
  });

  it("refuses wip-* names", () => {
    expect(isWipName("wip-bracket-left-r1.gcode.3mf")).toBe(true);
    expect(() => assertPrintableArtifact("wip-bracket-left-r1.gcode.3mf")).toThrow(/wip-\*/);
  });

  it("refuses scratch/ paths", () => {
    expect(isScratchPath("scratch/bracket-left-r1.gcode.3mf")).toBe(true);
    expect(isScratchPath("/tmp/scratch/out.gcode.3mf")).toBe(true);
    expect(() =>
      assertPrintableArtifact("scratch/bracket-left-r1.gcode.3mf"),
    ).toThrow(/scratch\//);
  });

  it("refuses mesh-only 3mf", () => {
    expect(() => assertPrintableArtifact("bracket-left-r1.3mf")).toThrow(/mesh-only/);
  });

  it("accepts a contract artifact", () => {
    expect(assertPrintableArtifact("/prints/bracket-left-r1.gcode.3mf").rev).toBe("r1");
  });
});

describe("print.json sidecar", () => {
  it("maps sibling path", () => {
    expect(sidecarPathFor("/out/clip-v1-r2.gcode.3mf")).toBe("/out/clip-v1-r2.print.json");
  });

  it("parses optional fields and applies defaults", () => {
    const sidecar = parseSidecar({
      plate: 2,
      useAms: true,
      amsMapping: [1, 2],
      timelapse: true,
    });
    expect(defaultPrintOptions("clip-v1-r2.gcode.3mf", sidecar)).toMatchObject({
      remoteName: "clip-v1-r2.gcode.3mf",
      plate: 2,
      amsMapping: [1, 2],
      timelapse: true,
      bedType: "auto",
    });
  });

  it("rejects a non-object sidecar", () => {
    expect(() => parseSidecar([])).toThrow(/JSON object/);
    expect(() => parseSidecar({ plate: 0 })).toThrow(/plate/);
  });
});
