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
} from "./contract.js";
import { guardWrite } from "./gates.js";
import { runSlice } from "./slice.js";

const BLOCKED =
  "Refused until BAMBU_SAFE_MODE=0. Motion tools still need confirm: true after an explicit human ask.";

const confirmField = z.boolean().describe("Must be true. Ask the operator before setting this.");

export function writeTools(
  port: PrinterPort,
  options: { safeMode: boolean; slicerBin?: string },
) {
  const { safeMode, slicerBin } = options;
  const motion = (
    [
      ["pause", "Pause the running print.", "paused", (p: PrinterPort) => p.pause()],
      ["resume", "Resume a paused print.", "resumed", (p: PrinterPort) => p.resume()],
      ["stop", "Cancel the running print.", "stopped", (p: PrinterPort) => p.stop()],
    ] as const
  ).map(([name, text, ok, run]) => ({
    name,
    description: `${text} ${BLOCKED}`,
    inputSchema: z.object({ confirm: confirmField }),
    handler: async (args: Record<string, unknown>) => {
      guardWrite(name, safeMode, args.confirm);
      await run(port);
      return { ok, confirmed: true };
    },
  }));

  return [
    {
      name: "upload",
      description: `Upload a {part}-{variant}-{rev}.gcode.3mf over FTPS. Does not start a print. ${BLOCKED}`,
      inputSchema: z.object({
        localPath: z.string().describe("Local path to the .gcode.3mf"),
        remoteName: z.string().optional().describe("Remote filename. Default: local basename"),
      }),
      handler: async (args: Record<string, unknown>) => {
        guardWrite("upload", safeMode, args.confirm);
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
        confirm: confirmField,
        plate: z.number().int().optional(),
        useAms: z.boolean().optional(),
        amsMapping: z.array(z.number().int()).optional(),
        alreadyUploaded: z.boolean().optional().describe("Skip FTPS upload and print the remote name."),
      }),
      handler: async (args: Record<string, unknown>) => {
        guardWrite("print", safeMode, args.confirm);
        const file = String(args.file);
        const artifact = assertPrintableArtifact(file);
        const local = looksLocal(file) && existsSync(file);
        const sidecar = local ? readSidecar(file) : {};
        const job = defaultPrintOptions(artifact.filename, sidecar);
        if (typeof args.plate === "number") job.plate = args.plate;
        if (typeof args.useAms === "boolean") job.useAms = args.useAms;
        if (Array.isArray(args.amsMapping)) job.amsMapping = args.amsMapping as number[];
        if (local && args.alreadyUploaded !== true) await port.upload(file, artifact.filename);
        await port.startPrint(job);
        return { printing: artifact.filename, ...job, confirmed: true };
      },
    },
    ...motion,
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
      handler: async (args: Record<string, unknown>) => {
        guardWrite("slice_hook", safeMode, args.confirm);
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
        return { output: result.output, cmd: result.cmd, artifact: filename, printJsonHint: sidecarPathFor(outputPath) };
      },
    },
    {
      name: "set_light",
      description:
        "Turn the chamber light on or off. Allowed while safe mode is on. Does not move the printer and does not need confirm.",
      inputSchema: z.object({
        on: z.boolean().describe("true turns the chamber light on. false turns it off."),
      }),
      handler: async (args: Record<string, unknown>) => {
        guardWrite("set_light", safeMode, args.confirm);
        if (typeof args.on !== "boolean") throw new Error("set_light needs { on: boolean }.");
        await port.setLight(args.on);
        return { on: args.on, led_node: "chamber_light" };
      },
    },
  ];
}

function readSidecar(printablePath: string) {
  const sidecar = sidecarPathFor(printablePath);
  if (!existsSync(sidecar)) return {};
  return parseSidecar(JSON.parse(readFileSync(sidecar, "utf8")));
}
