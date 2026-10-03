import { copyFileSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MockPrinter } from "../mock.js";
import {
  FAILED_SKULL_HEIGHT_MM,
  boxSolid,
  classifySolid,
  countSolids,
  cylinderSolid,
  isPrimitiveCsg,
  otherSolid,
  primitiveCsgSkull,
  sphereSolid,
} from "../cad/primitive.js";
import { defaultRefsDir, loadReferenceViews } from "../cad/refs.js";
import { validateMeshFile } from "../cad/gate.js";
import { refuseMotion, stageCandidate } from "../cad/stage.js";
import { isWatertight, signedVolume, writeBinaryStl } from "../cad/stl.js";
import { createTools, catalog } from "../tools/index.js";

const CAD_FILES = ["stl.ts", "primitive.ts", "refs.ts", "gate.ts", "stage.ts", "prove.ts"];

function writeMesh(dir: string, name: string, triangles: ReturnType<typeof primitiveCsgSkull>): string {
  const path = join(dir, name);
  writeFileSync(path, writeBinaryStl(triangles, "cad-gate fixture"));
  return path;
}

describe("primitive solids", () => {
  it("classifies a box, a sphere, and a cylinder, and keeps a tetrahedron as other", () => {
    const box = boxSolid({ x: 0, y: 0, z: 0 }, { x: 10, y: 20, z: 30 });
    const sphere = sphereSolid({ x: 0, y: 0, z: 0 }, 12);
    const cylinder = cylinderSolid(5, 0, 15);
    const other = otherSolid(FAILED_SKULL_HEIGHT_MM);

    for (const mesh of [box, sphere, cylinder, other]) {
      expect(isWatertight(mesh)).toBe(true);
      expect(signedVolume(mesh)).toBeGreaterThan(0);
    }
    expect(classifySolid(box)).toBe("box");
    expect(classifySolid(sphere)).toBe("sphere");
    expect(classifySolid(cylinder)).toBe("cylinder");
    expect(classifySolid(other)).toBe("other");
  });
});

describe("photo gate", () => {
  it("rejects a watertight 76.2 mm primitive CSG skull", () => {
    const dir = mkdtempSync(join(tmpdir(), "cad-primitive-"));
    const meshPath = writeMesh(dir, "fixture-primitive-r0.stl", primitiveCsgSkull());
    const report = validateMeshFile(meshPath, { units: "mm" });

    expect(report.watertight).toBe(true);
    expect(report.heightMm).toBeCloseTo(76.2, 2);
    expect(report.fitsP2sBed).toBe(true);
    expect(report.primitiveCsg).toBe(true);
    expect(report.solids).toMatchObject({ sphere: 3, box: 1, cylinder: 1, other: 0 });
    expect(report.accepted).toBe(false);
    expect(report.reasons).toContain("primitive-csg: spheres, boxes, and cylinders are not a likeness");
    expect(report.reasons).toContain("watertight and size are not a pass");
    expect(report.likeness.humanOrVlm).toBe("not-reviewed");
    expect(report.likeness.dinov2Cosine).toBeNull();
    expect(report.likeness.clipCosine).toBeNull();
    expect(report.likeness.cutoff).toBeNull();
    expect(report.likeness.sideView).toBeNull();
    expect(report.likeness.sidePhotoInvented).toBe(false);
    expect(report.likeness.viewCount).toBe(2);
    expect(report.likeness.oneViewFails).toBe(false);
    expect(report.copyright).toMatch(/Personal print only/);
  });

  it("does not pass a non-primitive mesh on watertight millimeters and bed scale", () => {
    const dir = mkdtempSync(join(tmpdir(), "cad-other-"));
    const meshPath = writeMesh(dir, "other-plain-r0.stl", otherSolid(FAILED_SKULL_HEIGHT_MM));
    const report = validateMeshFile(meshPath, { units: "mm" });

    expect(report.watertight).toBe(true);
    expect(report.heightMm).toBeCloseTo(76.2, 2);
    expect(report.fitsP2sBed).toBe(true);
    expect(report.primitiveCsg).toBe(false);
    expect(isPrimitiveCsg(countSolids(otherSolid(FAILED_SKULL_HEIGHT_MM)))).toBe(false);
    expect(report.accepted).toBe(false);
    expect(report.reasons).toContain("watertight and size are not a pass");
    expect(report.reasons).not.toContain("primitive-csg: spheres, boxes, and cylinders are not a likeness");
    expect(report.necessary).toMatchObject({ manifold: true, millimeters: true, p2sBed: true });
  });

  it("fails likeness when only one reference view is present", () => {
    const dir = mkdtempSync(join(tmpdir(), "cad-one-view-"));
    copyFileSync(
      join(defaultRefsDir(), "01-t800-endoskeleton-3q-oberhaus.jpg"),
      join(dir, "01-t800-endoskeleton-3q-oberhaus.jpg"),
    );
    writeFileSync(join(dir, "side.jpg"), "not a reference view");
    const views = loadReferenceViews(dir);
    expect(views.present.map((view) => view.id)).toEqual(["three-quarter"]);
    expect(views.missing).toEqual(["front"]);
    expect(views.sideView).toBeNull();
    expect(views.sidePhotoInvented).toBe(false);

    const meshDir = mkdtempSync(join(tmpdir(), "cad-one-mesh-"));
    const meshPath = writeMesh(meshDir, "other-plain-r0.stl", otherSolid(40));
    const report = validateMeshFile(meshPath, { units: "mm", refsDir: dir });
    expect(report.likeness.oneViewFails).toBe(true);
    expect(report.likeness.viewCount).toBe(1);
    expect(report.accepted).toBe(false);
    expect(report.reasons).toContain("likeness: one view is a fail");
  });

  it("loads both real reference photographs and no side", () => {
    const views = loadReferenceViews();
    expect(views.missing).toEqual([]);
    expect(views.present).toEqual([
      expect.objectContaining({
        id: "three-quarter",
        author: "Daniel Oberhaus",
        license: "CC BY 2.0",
        width: 4582,
        height: 3055,
      }),
      expect.objectContaining({
        id: "front",
        author: "Ank Kumar",
        license: "CC BY-SA 4.0",
        width: 3435,
        height: 3435,
      }),
    ]);
    expect(views.sideView).toBeNull();
  });

  it("rejects inch units even when the triangle count is closed", () => {
    const dir = mkdtempSync(join(tmpdir(), "cad-inch-"));
    const meshPath = writeMesh(dir, "other-plain-r0.stl", otherSolid(2));
    const report = validateMeshFile(meshPath, { units: "inch" });
    expect(report.necessary.millimeters).toBe(false);
    expect(report.heightMm).toBeNull();
    expect(report.fitsP2sBed).toBe(false);
    expect(report.accepted).toBe(false);
    expect(report.reasons).toContain("millimeters: units must be millimeters");
  });
});

describe("stage path", () => {
  it("writes a refusal record and no sliced plate", () => {
    const dir = mkdtempSync(join(tmpdir(), "cad-stage-"));
    const meshPath = writeMesh(dir, "fixture-primitive-r0.stl", primitiveCsgSkull());
    const outDir = join(dir, "out");
    const staged = stageCandidate({
      meshPath,
      outDir,
      part: "fixture",
      variant: "primitive",
      rev: "r0",
      units: "mm",
    });

    expect(staged).toMatchObject({
      accepted: false,
      gcode3mf: null,
      print: "refused",
      pause: "refused",
      cancel: "refused",
    });
    const names = readdirSync(outDir);
    expect(names).toEqual(["fixture-primitive-r0.stage.json", "gate.json"]);
    const record = JSON.parse(readFileSync(staged.stageRecordPath, "utf8")) as { gcode3mf: null; print: string };
    expect(record.gcode3mf).toBeNull();
    expect(record.print).toBe("refused");
    expect(JSON.parse(readFileSync(staged.gateReportPath, "utf8")).accepted).toBe(false);
  });

  it("refuses scratch/ and wip-* before writing", () => {
    const dir = mkdtempSync(join(tmpdir(), "cad-refuse-"));
    const meshPath = writeMesh(dir, "fixture-primitive-r0.stl", primitiveCsgSkull());
    const scratchMesh = join(dir, "scratch", "fixture-primitive-r0.stl");
    mkdirSync(join(dir, "scratch"));
    writeFileSync(scratchMesh, readFileSync(meshPath));
    const wipMesh = join(dir, "wip-fixture-primitive-r0.stl");
    writeFileSync(wipMesh, readFileSync(meshPath));

    expect(() =>
      stageCandidate({
        meshPath: scratchMesh,
        outDir: join(dir, "out-scratch"),
        part: "fixture",
        variant: "primitive",
        rev: "r0",
        units: "mm",
      }),
    ).toThrow(/Refuse start-print: path is under scratch\//);
    expect(() =>
      stageCandidate({
        meshPath: wipMesh,
        outDir: join(dir, "out-wip"),
        part: "fixture",
        variant: "primitive",
        rev: "r0",
        units: "mm",
      }),
    ).toThrow(/Refuse start-print: wip-\*/);
    expect(() =>
      stageCandidate({
        meshPath,
        outDir: join(dir, "scratch"),
        part: "fixture",
        variant: "primitive",
        rev: "r0",
        units: "mm",
      }),
    ).toThrow(/scratch\//);

    expect(readdirSync(dir)).not.toContain("out-scratch");
    expect(readdirSync(dir)).not.toContain("out-wip");
  });

  it("cannot start, pause, or cancel, and does not touch a printer", () => {
    const port = new MockPrinter();
    for (const action of ["start", "pause", "cancel"] as const) {
      expect(() => refuseMotion(action)).toThrow(
        new RegExp(`Refuse start-print: the CAD path cannot ${action} a print`),
      );
    }
    expect(port.started).toEqual([]);
    expect(port.commands).toEqual([]);
    expect(port.state).toBe("IDLE");
  });

  it("adds no MCP tool and does not open the printer client", () => {
    expect(catalog.map((tool) => tool.name)).toEqual([
      "status",
      "temps",
      "ams",
      "list_files",
      "get_version",
      "set_light",
      "set_camera",
      "set_sound",
      "upload",
      "print",
      "pause",
      "resume",
      "stop",
      "slice_hook",
    ]);
    expect(createTools(new MockPrinter(), { safeMode: true }).map((tool) => tool.name)).toEqual([
      "status",
      "temps",
      "ams",
      "list_files",
      "get_version",
      "set_light",
      "set_camera",
      "set_sound",
    ]);

    for (const file of CAD_FILES) {
      const text = readFileSync(new URL(`../cad/${file}`, import.meta.url), "utf8");
      expect(text).not.toMatch(/client\.js|tools\/motion|BAMBU_ACCESS_CODE|BAMBU_IP|BAMBU_SERIAL/);
      expect(text).not.toMatch(/startPrint/);
      if (file !== "prove.ts") expect(text).not.toMatch(/meshy|rodin|trellis/i);
    }
    const prove = readFileSync(new URL("../cad/prove.ts", import.meta.url), "utf8");
    expect(prove).toMatch(/TRELLIS\.2: not run/);
    expect(prove).not.toMatch(/huggingface|api\.meshy|hyper3d|torch\.hub/);
  });
});
