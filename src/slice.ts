import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir, platform } from "node:os";
import { delimiter, join } from "node:path";
import type { SliceRequest, SliceRunner } from "./types.js";

const CANDIDATES = [
  "orca-slicer",
  "orcaslicer",
  "OrcaSlicer",
  "bambu-studio",
  "bambu-studio-cli",
  join(homedir(), "Applications/OrcaSlicer.AppImage"),
  join(homedir(), "Applications/BambuStudio.AppImage"),
];

function isOnPath(cmd: string): boolean {
  const dirs = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  const exts = platform() === "win32" ? ["", ".exe", ".bat", ".cmd"] : [""];
  return dirs.some((dir) => exts.some((ext) => existsSync(join(dir, cmd + ext))));
}

/** Resolve OrcaSlicer / Bambu Studio CLI. Shared PrusaSlicer-fork flags. */
export function resolveSlicerBin(explicit?: string): string {
  if (explicit) return explicit;
  for (const candidate of CANDIDATES) {
    if (candidate.includes("/") || candidate.includes("\\")) {
      if (existsSync(candidate)) return candidate;
    } else if (isOnPath(candidate)) {
      return candidate;
    }
  }
  throw new Error(
    "No slicer found. Set SLICER_BIN to orca-slicer or a Bambu Studio CLI/AppImage path.",
  );
}

export function buildSlicerArgs(request: SliceRequest): string[] {
  const args = ["--slice", String(request.plate)];
  if (request.settings) args.push("--load-settings", request.settings);
  if (request.filaments) args.push("--load-filaments", request.filaments);
  args.push("--arrange", request.arrange ? "1" : "0");
  args.push("--orient", request.orient ? "1" : "0");
  args.push("--export-3mf", request.outputPath, request.inputPath);
  return args;
}

function runProcess(bin: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`Slice timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(`Slice failed (exit ${code}). ${stderr.slice(-1500)}`));
    });
  });
}

export class CliSliceRunner implements SliceRunner {
  constructor(
    private readonly bin: string,
    private readonly spawnFn: typeof runProcess = runProcess,
    private readonly timeoutMs = 1_800_000,
  ) {}

  async run(request: SliceRequest): Promise<{ output: string; cmd: string }> {
    const args = buildSlicerArgs(request);
    await this.spawnFn(this.bin, args, this.timeoutMs);
    return { output: request.outputPath, cmd: [this.bin, ...args].join(" ") };
  }
}

/** Resolve the slicer binary at call time so a missing CLI fails the tool, not startup. */
export function createSliceRunner(slicerBin?: string): SliceRunner {
  return {
    run(request) {
      return new CliSliceRunner(resolveSlicerBin(slicerBin)).run(request);
    },
  };
}
