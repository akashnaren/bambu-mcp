import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { assertRejectedPath, formatPrintableName } from "../contract.js";
import { validateMeshFile, type CadGateReport } from "./gate.js";

export type MotionWord = "start" | "pause" | "cancel";

export interface StageResult {
  dir: string;
  gateReportPath: string;
  stageRecordPath: string;
  accepted: false;
  gcode3mf: null;
  print: "refused";
  pause: "refused";
  cancel: "refused";
  part: string;
  variant: string;
  rev: string;
}

/**
 * The CAD path has no printer client. Calling this is the only motion entry, and it refuses.
 * Safe mode stays on. Nothing is uploaded.
 */
export function refuseMotion(action: MotionWord): never {
  throw new Error(
    `Refuse start-print: the CAD path cannot ${action} a print. BAMBU_SAFE_MODE stays on. No upload.`,
  );
}

export function stageCandidate(input: {
  meshPath: string;
  outDir: string;
  part: string;
  variant: string;
  rev: string;
  units: string;
  refsDir?: string;
}): StageResult {
  assertRejectedPath(input.meshPath);
  assertRejectedPath(input.outDir);
  const printable = formatPrintableName(input.part, input.variant, input.rev);
  const stem = printable.replace(/\.gcode\.3mf$/i, "");
  const report: CadGateReport = validateMeshFile(input.meshPath, {
    units: input.units,
    refsDir: input.refsDir,
  });
  if (report.accepted) {
    throw new Error("Refuse start-print: this CAD path cannot record a likeness pass from this VM.");
  }
  mkdirSync(input.outDir, { recursive: true });
  const gateReportPath = join(input.outDir, "gate.json");
  const stageRecordPath = join(input.outDir, `${stem}.stage.json`);
  const record = {
    printer: "p2s",
    part: input.part,
    variant: input.variant,
    rev: input.rev,
    accepted: false as const,
    gcode3mf: null,
    print: "refused" as const,
    pause: "refused" as const,
    cancel: "refused" as const,
    personalPrintOnly: true,
    meshPublished: false,
    note: "CAD stage writes this record and does not start, pause, or cancel a print.",
    reasons: report.reasons,
  };
  writeFileSync(gateReportPath, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(stageRecordPath, `${JSON.stringify(record, null, 2)}\n`);
  return {
    dir: input.outDir,
    gateReportPath,
    stageRecordPath,
    accepted: false,
    gcode3mf: null,
    print: "refused",
    pause: "refused",
    cancel: "refused",
    part: input.part,
    variant: input.variant,
    rev: input.rev,
  };
}
