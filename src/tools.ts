import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { z } from "zod";
import type { PrinterPort } from "./client.js";
import {
  assertPrintableArtifact,
  defaultPrintOptions,
  formatPrintableName,
  isSliceableInput,
  looksLocal,
  parseSidecar,
  sidecarPathFor,
  type PrintSidecar,
} from "./contract.js";
import { assertConfirmed, assertSafeMode } from "./gates.js";
import { runSlice } from "./slice.js";

export interface RegisteredTool {
  name: string;
  description: string;
  inputSchema: z.ZodObject<z.ZodRawShape>;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}

const BLOCKED =
  "Refused until BAMBU_SAFE_MODE=0. Motion tools still need confirm: true after an explicit human ask.";

function guard(tool: string, safeMode: boolean, confirm: unknown): void {
  assertSafeMode(tool, safeMode);
  assertConfirmed(tool, confirm);
}

function loadSidecar(printablePath: string): PrintSidecar {
  const sidecar = sidecarPathFor(printablePath);
  if (!existsSync(sidecar)) return {};
  return parseSidecar(JSON.parse(readFileSync(sidecar, "utf8")));
}

export function createTools(
  port: PrinterPort,
  options?: { safeMode?: boolean; slicerBin?: string },
): RegisteredTool[] {
  const safeMode = options?.safeMode ?? true;
  const slicerBin = options?.slicerBin;

  return [
    {
      name: "status",
      description: "Read print state: gcode_state, progress, remaining minutes, layer, job. Includes safeMode.",
      inputSchema: z.object({}),
      handler: async () => ({ ...(await port.status()), safeMode }),
    },
    {
      name: "temps",
      description: "Read nozzle, bed, and chamber temperatures in °C.",
      inputSchema: z.object({}),
      handler: async () => port.temps(),
    },
    {
      name: "ams",
      description: "Read AMS units, filament slots, and the active slot.",
      inputSchema: z.object({}),
      handler: async () => port.ams(),
    },
    {
      name: "list_files",
      description: "List files on the printer FTPS cache.",
      inputSchema: z.object({
        dir: z.string().optional().describe("Remote directory. Default /"),
      }),
      handler: async (args) => ({
        files: await port.listFiles(typeof args.dir === "string" ? args.dir : "/"),
      }),
    },
    {
      name: "upload",
      description: `Upload a {part}-{variant}-{rev}.gcode.3mf over FTPS. Does not start a print. ${BLOCKED}`,
      inputSchema: z.object({
        localPath: z.string().describe("Local path to the .gcode.3mf"),
        remoteName: z.string().optional().describe("Remote filename. Default: local basename"),
      }),
      handler: async (args) => {
        guard("upload", safeMode, args.confirm);
        const localPath = String(args.localPath);
        if (!existsSync(localPath)) throw new Error(`No such file: ${localPath}`);
        const parsed = assertPrintableArtifact(localPath);
        const remote = args.remoteName ? String(args.remoteName) : parsed.filename;
        assertPrintableArtifact(remote);
        await port.upload(localPath, remote);
        return { uploaded: remote };
      },
    },
    {
      name: "print",
      description: `Start printing a {part}-{variant}-{rev}.gcode.3mf. Refuses .stl, wip-*, and scratch/. ${BLOCKED}`,
      inputSchema: z.object({
        file: z.string().describe("Local path or remote filename of the .gcode.3mf"),
        confirm: z.boolean().describe("Must be true. Ask the operator before setting this."),
        plate: z.number().int().optional(),
        useAms: z.boolean().optional(),
        amsMapping: z.array(z.number().int()).optional(),
        alreadyUploaded: z.boolean().optional().describe("Skip FTPS upload and print the remote name."),
      }),
      handler: async (args) => {
        guard("print", safeMode, args.confirm);
        const file = String(args.file);
        const artifact = assertPrintableArtifact(file);
        const local = looksLocal(file) && existsSync(file);
        const sidecar = local ? loadSidecar(file) : {};
        const job = defaultPrintOptions(artifact.filename, sidecar);
        if (typeof args.plate === "number") job.plate = args.plate;
        if (typeof args.useAms === "boolean") job.useAms = args.useAms;
        if (Array.isArray(args.amsMapping)) job.amsMapping = args.amsMapping as number[];
        if (local && args.alreadyUploaded !== true) {
          await port.upload(file, artifact.filename);
        }
        await port.startPrint(job);
        return { printing: artifact.filename, ...job, confirmed: true };
      },
    },
    {
      name: "pause",
      description: `Pause the running print. ${BLOCKED}`,
      inputSchema: z.object({
        confirm: z.boolean().describe("Must be true after the operator agrees."),
      }),
      handler: async (args) => {
        guard("pause", safeMode, args.confirm);
        await port.pause();
        return { ok: "paused", confirmed: true };
      },
    },
    {
      name: "resume",
      description: `Resume a paused print. ${BLOCKED}`,
      inputSchema: z.object({
        confirm: z.boolean().describe("Must be true after the operator agrees."),
      }),
      handler: async (args) => {
        guard("resume", safeMode, args.confirm);
        await port.resume();
        return { ok: "resumed", confirmed: true };
      },
    },
    {
      name: "stop",
      description: `Cancel the running print. ${BLOCKED}`,
      inputSchema: z.object({
        confirm: z.boolean().describe("Must be true after the operator agrees."),
      }),
      handler: async (args) => {
        guard("stop", safeMode, args.confirm);
        await port.stop();
        return { ok: "stopped", confirmed: true };
      },
    },
    {
      name: "slice_hook",
      description: `Slice an STL or mesh 3MF to {part}-{variant}-{rev}.gcode.3mf. Does not upload or print. ${BLOCKED}`,
      inputSchema: z.object({
        inputPath: z.string().describe("Local .stl, .step, .obj, or mesh .3mf"),
        part: z.string(),
        variant: z.string(),
        rev: z.string(),
        outputDir: z.string().optional(),
        settings: z.string().optional().describe("Semicolon-joined printer;process presets. Required for a bare STL."),
        filaments: z.string().optional(),
        plate: z.number().int().optional(),
        arrange: z.boolean().optional(),
        orient: z.boolean().optional(),
      }),
      handler: async (args) => {
        guard("slice_hook", safeMode, args.confirm);
        const inputPath = String(args.inputPath);
        if (!existsSync(inputPath)) throw new Error(`No such file: ${inputPath}`);
        if (!isSliceableInput(inputPath)) {
          throw new Error(`slice_hook accepts .stl, .step, .obj, or .3mf, got ${basename(inputPath)}`);
        }
        const filename = formatPrintableName(String(args.part), String(args.variant), String(args.rev));
        const outputDir = typeof args.outputDir === "string" ? args.outputDir : ".";
        const outputPath = join(outputDir, filename);
        if (/\.stl$/i.test(inputPath) && !args.settings) {
          throw new Error("Bare STL needs slicer presets in settings (printer JSON;process JSON).");
        }
        const result = await runSlice(slicerBin, {
          inputPath,
          outputPath,
          plate: typeof args.plate === "number" ? args.plate : 0,
          settings: typeof args.settings === "string" ? args.settings : undefined,
          filaments: typeof args.filaments === "string" ? args.filaments : undefined,
          arrange: args.arrange !== false,
          orient: args.orient !== false,
        });
        return {
          output: result.output,
          cmd: result.cmd,
          artifact: filename,
          printJsonHint: sidecarPathFor(outputPath),
        };
      },
    },
  ];
}
