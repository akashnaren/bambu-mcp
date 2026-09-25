import { basename, dirname, sep } from "node:path";

/** Optional sibling of `{part}-{variant}-{rev}.gcode.3mf`. Name comes from the file, not this object. */
export interface PrintSidecar {
  plate?: number;
  useAms?: boolean;
  amsMapping?: number[];
  bedType?: string;
  timelapse?: boolean;
  flowCali?: boolean;
  bedLeveling?: boolean;
  vibrationCali?: boolean;
  layerInspect?: boolean;
}

const PRINTABLE_NAME =
  /^(?<part>[A-Za-z0-9][A-Za-z0-9_]*)-(?<variant>[A-Za-z0-9][A-Za-z0-9_]*)-(?<rev>[A-Za-z0-9][A-Za-z0-9_]*)\.gcode\.3mf$/;

const MESH_INPUT = /\.(stl|step|stp|obj|3mf)$/i;

export interface ArtifactName {
  part: string;
  variant: string;
  rev: string;
  filename: string;
}

function parsePrintableName(filename: string): ArtifactName | null {
  const name = basename(filename);
  const match = PRINTABLE_NAME.exec(name);
  if (!match?.groups) return null;
  return {
    part: match.groups.part,
    variant: match.groups.variant,
    rev: match.groups.rev,
    filename: name,
  };
}

export function formatPrintableName(part: string, variant: string, rev: string): string {
  const filename = `${part}-${variant}-${rev}.gcode.3mf`;
  if (!PRINTABLE_NAME.test(filename)) {
    throw new Error(
      `Invalid printable name ${filename}. part, variant, and rev must be letters, digits, or underscores, and must start with a letter or digit.`,
    );
  }
  return filename;
}

export function sidecarPathFor(printablePath: string): string {
  return printablePath.replace(/\.gcode\.3mf$/i, ".print.json");
}

function pathSegments(filePath: string): string[] {
  return filePath.split(/[\\/]+/).filter(Boolean);
}

function isScratchPath(filePath: string): boolean {
  return pathSegments(filePath).some((segment) => segment.toLowerCase() === "scratch");
}

function isWipName(filePath: string): boolean {
  return basename(filePath).toLowerCase().startsWith("wip-");
}

function isBareStl(filePath: string): boolean {
  return /\.stl$/i.test(filePath);
}

function isMeshOnly3mf(filePath: string): boolean {
  return /\.3mf$/i.test(filePath) && !/\.gcode\.3mf$/i.test(filePath);
}

const SLICED_NAME = "Run slice_hook to produce {part}-{variant}-{rev}.gcode.3mf.";

function refuse(detail: string): never {
  throw new Error(`Refuse start-print: ${detail}`);
}

export function isSliceableInput(filePath: string): boolean {
  return MESH_INPUT.test(filePath);
}

export function assertPrintableArtifact(filePath: string): ArtifactName {
  if (isScratchPath(filePath)) {
    refuse(`path is under scratch/ (${filePath}). Promote out of scratch first.`);
  }
  if (isWipName(filePath)) {
    refuse(`wip-* artifacts are not printable (${basename(filePath)}).`);
  }
  if (isBareStl(filePath)) {
    refuse(`bare STL is not printable. ${SLICED_NAME}`);
  }
  if (isMeshOnly3mf(filePath)) {
    refuse(`mesh-only .3mf is not sliced. ${SLICED_NAME}`);
  }
  const parsed = parsePrintableName(filePath);
  if (!parsed) {
    refuse(`expected {part}-{variant}-{rev}.gcode.3mf, got ${basename(filePath)}.`);
  }
  return parsed;
}

export function parseSidecar(raw: unknown): PrintSidecar {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("print.json must be a JSON object");
  }
  const obj = raw as Record<string, unknown>;
  const sidecar: PrintSidecar = {};

  if (obj.bedType !== undefined) {
    if (typeof obj.bedType !== "string") throw new Error("print.json.bedType must be a string");
    sidecar.bedType = obj.bedType;
  }
  if (obj.plate !== undefined) {
    if (!Number.isInteger(obj.plate) || (obj.plate as number) < 1) {
      throw new Error("print.json.plate must be a positive integer");
    }
    sidecar.plate = obj.plate as number;
  }
  if (obj.amsMapping !== undefined) {
    if (
      !Array.isArray(obj.amsMapping) ||
      !obj.amsMapping.every((n) => Number.isInteger(n) && n >= 0)
    ) {
      throw new Error("print.json.amsMapping must be an array of non-negative integers");
    }
    sidecar.amsMapping = obj.amsMapping as number[];
  }
  for (const key of [
    "useAms",
    "timelapse",
    "flowCali",
    "bedLeveling",
    "vibrationCali",
    "layerInspect",
  ] as const) {
    if (obj[key] !== undefined) {
      if (typeof obj[key] !== "boolean") throw new Error(`print.json.${key} must be a boolean`);
      sidecar[key] = obj[key];
    }
  }
  return sidecar;
}

export function defaultPrintOptions(remoteName: string, sidecar: PrintSidecar = {}) {
  return {
    remoteName: basename(remoteName),
    plate: sidecar.plate ?? 1,
    useAms: sidecar.useAms ?? true,
    amsMapping: sidecar.amsMapping ?? [0],
    bedType: sidecar.bedType ?? "auto",
    timelapse: sidecar.timelapse ?? false,
    flowCali: sidecar.flowCali ?? true,
    bedLeveling: sidecar.bedLeveling ?? true,
    vibrationCali: sidecar.vibrationCali ?? true,
    layerInspect: sidecar.layerInspect ?? false,
  };
}

/** True when a path looks like a local filesystem path rather than a remote basename. */
export function looksLocal(filePath: string): boolean {
  return filePath.includes(sep) || filePath.startsWith(".") || dirname(filePath) !== ".";
}
