import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir, platform } from "node:os";
import { delimiter, join } from "node:path";

export interface SliceJob {
  inputPath: string;
  outputPath: string;
  plate: number;
  settings?: string;
  filaments?: string;
  arrange: boolean;
  orient: boolean;
}

function resolveBin(explicit?: string): string {
  if (explicit) return explicit;
  const names = ["orca-slicer", "orcaslicer", "OrcaSlicer", "bambu-studio", "bambu-studio-cli"];
  const dirs = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  const exts = platform() === "win32" ? ["", ".exe", ".bat", ".cmd"] : [""];
  for (const name of names) {
    for (const dir of dirs) {
      if (exts.some((ext) => existsSync(join(dir, name + ext)))) return name;
    }
  }
  for (const app of ["OrcaSlicer.AppImage", "BambuStudio.AppImage"]) {
    const full = join(homedir(), "Applications", app);
    if (existsSync(full)) return full;
  }
  throw new Error("No slicer found. Set SLICER_BIN to orca-slicer or a Bambu Studio CLI path.");
}

function argsFor(job: SliceJob): string[] {
  const args = ["--slice", String(job.plate)];
  if (job.settings) args.push("--load-settings", job.settings);
  if (job.filaments) args.push("--load-filaments", job.filaments);
  args.push("--arrange", job.arrange ? "1" : "0", "--orient", job.orient ? "1" : "0");
  args.push("--export-3mf", job.outputPath, job.inputPath);
  return args;
}

/** Run OrcaSlicer / Bambu Studio. Does not upload or start a print. */
export function runSlice(
  bin: string | undefined,
  job: SliceJob,
): Promise<{ output: string; cmd: string }> {
  const resolved = resolveBin(bin);
  const args = argsFor(job);
  const cmd = [resolved, ...args].join(" ");
  return new Promise((resolve, reject) => {
    const child = spawn(resolved, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    const timer = setTimeout(
      () => {
        child.kill("SIGKILL");
        reject(new Error("Slice timed out after 30 minutes"));
      },
      30 * 60 * 1000,
    );
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ output: job.outputPath, cmd });
      else reject(new Error(`Slice failed (exit ${code}). ${stderr.slice(-1500)}`));
    });
  });
}
