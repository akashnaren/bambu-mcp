import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { z } from "zod";
import { assertConfirmed } from "./confirm.js";
import {
  assertPrintableArtifact,
  defaultPrintOptions,
  formatPrintableName,
  isSliceableInput,
  looksLocal,
  parseSidecar,
  sidecarPathFor,
} from "./contract.js";
import type { PrinterPort, PrintSidecar, SliceRunner } from "./types.js";

export interface ToolResult {
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

export interface RegisteredTool {
  name: string;
  description: string;
  inputSchema: z.ZodObject<z.ZodRawShape>;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}

function loadSidecar(printablePath: string): PrintSidecar {
  const sidecar = sidecarPathFor(printablePath);
  if (!existsSync(sidecar)) return {};
  return parseSidecar(JSON.parse(readFileSync(sidecar, "utf8")));
}

function jsonOk(value: unknown): unknown {
  return value;
}

export function createTools(port: PrinterPort, slice?: SliceRunner): RegisteredTool[] {
  return [
    {
      name: "status",
      description:
        "Read Bambu LAN print state: gcode_state, progress %, remaining minutes, layer, job name.",
      inputSchema: z.object({}),
      handler: async () => jsonOk(await port.status()),
    },
    {
      name: "temps",
      description: "Read nozzle / bed / chamber temperatures (°C, current + target).",
      inputSchema: z.object({}),
      handler: async () => jsonOk(await port.temps()),
    },
    {
      name: "ams",
      description: "Read AMS units and per-slot filament type, color, nozzle range, and active slot.",
      inputSchema: z.object({}),
      handler: async () => jsonOk(await port.ams()),
    },
    {
      name: "list_files",
      description: "List files on the printer FTPS cache (implicit TLS :990).",
      inputSchema: z.object({
        dir: z.string().optional().describe("Remote directory (default /)"),
      }),
      handler: async (args) => {
        const dir = typeof args.dir === "string" ? args.dir : "/";
        return jsonOk({ files: await port.listFiles(dir) });
      },
    },
    {
      name: "upload",
      description:
        "Upload a sliced Imagine artifact over FTPS. File must be {part}-{variant}-{rev}.gcode.3mf. Does not start a print.",
      inputSchema: z.object({
        localPath: z.string().describe("Local path to the .gcode.3mf"),
        remoteName: z
          .string()
          .optional()
          .describe("Remote filename (default: local basename)"),
      }),
      handler: async (args) => {
        const localPath = String(args.localPath);
        if (!existsSync(localPath)) throw new Error(`No such file: ${localPath}`);
        const parsed = assertPrintableArtifact(localPath);
        const remote = args.remoteName ? String(args.remoteName) : parsed.filename;
        assertPrintableArtifact(remote);
        await port.upload(localPath, remote);
        return jsonOk({ uploaded: remote });
      },
    },
    {
      name: "print",
      description:
        "Start printing a {part}-{variant}-{rev}.gcode.3mf. Refuses bare STL, wip-*, and scratch/. Requires confirm: true after the operator agrees. Optional sibling .print.json supplies plate/AMS defaults.",
      inputSchema: z.object({
        file: z
          .string()
          .describe("Local path or remote filename of the .gcode.3mf"),
        confirm: z
          .boolean()
          .describe("Must be true. Ask the operator before setting this."),
        plate: z.number().int().optional(),
        useAms: z.boolean().optional(),
        amsMapping: z.array(z.number().int()).optional(),
        alreadyUploaded: z
          .boolean()
          .optional()
          .describe("If true, skip FTPS upload and print the remote name."),
      }),
      handler: async (args) => {
        assertConfirmed("print", args.confirm);
        const file = String(args.file);
        const artifact = assertPrintableArtifact(file);
        const local = looksLocal(file) && existsSync(file);
        const sidecar = local ? loadSidecar(file) : {};
        const options = defaultPrintOptions(artifact.filename, sidecar);
        if (typeof args.plate === "number") options.plate = args.plate;
        if (typeof args.useAms === "boolean") options.useAms = args.useAms;
        if (Array.isArray(args.amsMapping)) options.amsMapping = args.amsMapping as number[];

        if (local && args.alreadyUploaded !== true) {
          await port.upload(file, artifact.filename);
        }
        await port.startPrint(options);
        return jsonOk({ printing: artifact.filename, ...options, confirmed: true });
      },
    },
    {
      name: "pause",
      description: "Pause the running print. Requires confirm: true.",
      inputSchema: z.object({
        confirm: z.boolean().describe("Must be true after the operator agrees."),
      }),
      handler: async (args) => {
        assertConfirmed("pause", args.confirm);
        await port.pause();
        return jsonOk({ ok: "paused", confirmed: true });
      },
    },
    {
      name: "resume",
      description: "Resume a paused print. Requires confirm: true.",
      inputSchema: z.object({
        confirm: z.boolean().describe("Must be true after the operator agrees."),
      }),
      handler: async (args) => {
        assertConfirmed("resume", args.confirm);
        await port.resume();
        return jsonOk({ ok: "resumed", confirmed: true });
      },
    },
    {
      name: "stop",
      description: "Cancel the running print (not resumable). Requires confirm: true.",
      inputSchema: z.object({
        confirm: z.boolean().describe("Must be true after the operator agrees."),
      }),
      handler: async (args) => {
        assertConfirmed("stop", args.confirm);
        await port.stop();
        return jsonOk({ ok: "stopped", confirmed: true });
      },
    },
    {
      name: "slice_hook",
      description:
        "Slice an STL or mesh-only 3MF into {part}-{variant}-{rev}.gcode.3mf via OrcaSlicer / Bambu Studio CLI. Does not upload or print. Bare STL is allowed here only.",
      inputSchema: z.object({
        inputPath: z.string().describe("Local .stl / .step / mesh .3mf"),
        part: z.string(),
        variant: z.string(),
        rev: z.string(),
        outputDir: z.string().optional(),
        settings: z
          .string()
          .optional()
          .describe("Semicolon-joined printer;process JSON presets (required for bare STL)"),
        filaments: z.string().optional(),
        plate: z.number().int().optional(),
        arrange: z.boolean().optional(),
        orient: z.boolean().optional(),
      }),
      handler: async (args) => {
        if (!slice) {
          throw new Error("slice_hook is not configured (no SliceRunner). Set SLICER_BIN.");
        }
        const inputPath = String(args.inputPath);
        if (!existsSync(inputPath)) throw new Error(`No such file: ${inputPath}`);
        if (!isSliceableInput(inputPath)) {
          throw new Error(`slice_hook accepts .stl / .step / .obj / .3mf, got ${basename(inputPath)}`);
        }
        const filename = formatPrintableName(
          String(args.part),
          String(args.variant),
          String(args.rev),
        );
        const outputDir = typeof args.outputDir === "string" ? args.outputDir : ".";
        const outputPath = join(outputDir, filename);
        if (/\.stl$/i.test(inputPath) && !args.settings) {
          throw new Error(
            "Bare STL needs slicer presets. Export printer+process JSON from Bambu Studio / OrcaSlicer and pass settings.",
          );
        }
        const result = await slice.run({
          inputPath,
          outputPath,
          plate: typeof args.plate === "number" ? args.plate : 0,
          settings: typeof args.settings === "string" ? args.settings : undefined,
          filaments: typeof args.filaments === "string" ? args.filaments : undefined,
          arrange: args.arrange !== false,
          orient: args.orient !== false,
        });
        return jsonOk({
          output: result.output,
          cmd: result.cmd,
          artifact: filename,
          printJsonHint: sidecarPathFor(outputPath),
        });
      },
    },
  ];
}
