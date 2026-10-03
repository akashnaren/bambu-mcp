import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { primitiveCsgSkull } from "./primitive.js";
import { defaultRefsDir, loadReferenceViews } from "./refs.js";
import { refuseMotion, stageCandidate } from "./stage.js";
import { writeBinaryStl } from "./stl.js";

function gpuAbsent(): boolean {
  if (existsSync("/dev/nvidia0") || existsSync("/dev/nvidiactl")) return false;
  const smi = spawnSync("nvidia-smi", ["-L"], { encoding: "utf8" });
  return smi.error !== undefined || smi.status !== 0;
}

function fail(message: string): never {
  console.error(`proof failed: ${message}`);
  process.exit(1);
}

const root = mkdtempSync(join(tmpdir(), "cad-gate-"));
const meshPath = join(root, "fixture-primitive-r0.stl");
const outDir = join(root, "stage");
writeFileSync(meshPath, writeBinaryStl(primitiveCsgSkull(), "primitive-csg fixture"));

const staged = stageCandidate({
  meshPath,
  outDir,
  part: "fixture",
  variant: "primitive",
  rev: "r0",
  units: "mm",
});

const report = JSON.parse(readFileSync(staged.gateReportPath, "utf8")) as {
  accepted: boolean;
  watertight: boolean;
  heightMm: number;
  fitsP2sBed: boolean;
  primitiveCsg: boolean;
  solids: { sphere: number; box: number; cylinder: number; other: number };
  likeness: {
    viewCount: number;
    oneViewFails: boolean;
    sideView: null;
    sidePhotoInvented: boolean;
    humanOrVlm: string;
    dinov2Cosine: null;
    clipCosine: null;
    cutoff: null;
  };
  reasons: string[];
};

if (report.accepted) fail("primitive mesh was accepted");
if (!report.watertight) fail("fixture was not watertight");
if (!report.fitsP2sBed) fail("fixture did not fit the P2S bed");
if (!report.primitiveCsg) fail("fixture was not classified as primitive CSG");
if (report.solids.sphere < 1 || report.solids.box < 1 || report.solids.cylinder < 1) {
  fail(`fixture solids were ${JSON.stringify(report.solids)}`);
}
if (Math.abs(report.heightMm - 76.2) > 0.01) fail(`height was ${report.heightMm}`);
if (report.likeness.viewCount !== 2 || report.likeness.oneViewFails) fail("both reference views were not loaded");
if (report.likeness.sideView !== null || report.likeness.sidePhotoInvented) fail("a side view was invented");
if (
  report.likeness.cutoff !== null ||
  report.likeness.dinov2Cosine !== null ||
  report.likeness.clipCosine !== null
) {
  fail("a cosine cutoff was invented");
}

const names = readdirSync(outDir);
if (names.some((name) => name.endsWith(".gcode.3mf") || name.endsWith(".stl") || name.endsWith(".3mf"))) {
  fail(`stage wrote a mesh or sliced plate: ${names.join(", ")}`);
}

const oneDir = join(root, "one-view");
mkdirSync(oneDir);
copyFileSync(
  join(defaultRefsDir(), "02-terminator-salvation-skull-front-ank-kumar.jpg"),
  join(oneDir, "02-terminator-salvation-skull-front-ank-kumar.jpg"),
);
const one = loadReferenceViews(oneDir);
if (one.present.length !== 1 || !one.missing.includes("three-quarter")) fail("one view was not a fail");

let motionRefused = 0;
for (const action of ["start", "pause", "cancel"] as const) {
  try {
    refuseMotion(action);
    fail(`${action} returned`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.startsWith("Refuse start-print:")) fail(`${action} did not refuse start-print: ${message}`);
    motionRefused += 1;
  }
}

let scratchRefused = false;
try {
  stageCandidate({
    meshPath: join(root, "scratch", "fixture-primitive-r0.stl"),
    outDir: join(root, "scratch-out"),
    part: "fixture",
    variant: "primitive",
    rev: "r0",
    units: "mm",
  });
} catch (error) {
  scratchRefused = error instanceof Error && /scratch\//.test(error.message);
}
if (!scratchRefused) fail("scratch/ was not refused");

let wipRefused = false;
try {
  stageCandidate({
    meshPath: join(root, "wip-fixture-primitive-r0.stl"),
    outDir: join(root, "wip-out"),
    part: "fixture",
    variant: "primitive",
    rev: "r0",
    units: "mm",
  });
} catch (error) {
  wipRefused = error instanceof Error && /wip-\*/.test(error.message);
}
if (!wipRefused) fail("wip-* was not refused");
if (!gpuAbsent()) fail("an NVIDIA device is present; this proof assumed it was not");

const lines = [
  "CAD photo gate",
  "printer: P2S",
  "safeMode: on",
  "TRELLIS.2: not run (no NVIDIA GPU; nvidia-smi absent; weights not downloaded)",
  "Meshy: not called",
  "Rodin: not called",
  "mesh published: no",
  "failed script: /workspace/prints/make_t800_skull.py (not in this repo)",
  "fixture: primitive CSG spheres+boxes+cylinders",
  `watertight: ${report.watertight}`,
  `heightMm: ${report.heightMm.toFixed(4)}`,
  `fitsP2sBed: ${report.fitsP2sBed}`,
  `primitiveCsg: ${report.primitiveCsg}`,
  `solids: sphere=${report.solids.sphere} box=${report.solids.box} cylinder=${report.solids.cylinder} other=${report.solids.other}`,
  `reference views: ${report.likeness.viewCount}`,
  "side view: none (not invented)",
  `humanOrVlm: ${report.likeness.humanOrVlm}`,
  "dinov2Cosine: null",
  "clipCosine: null",
  "cutoff: null",
  `accepted: ${report.accepted}`,
  "reasons:",
  ...report.reasons.map((reason) => `- ${reason}`),
  "stage: gate.json + fixture-primitive-r0.stage.json",
  "gcode.3mf: null",
  `print: ${staged.print}`,
  `pause: ${staged.pause}`,
  `cancel: ${staged.cancel}`,
  `motion refused: ${motionRefused}`,
  `scratch refused: ${scratchRefused}`,
  `wip refused: ${wipRefused}`,
  "one view: fail",
];

console.log(lines.join("\n"));
