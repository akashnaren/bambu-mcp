import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { z } from "zod";
import type { LightNode, PrinterPort } from "./client.js";
import type { Capabilities } from "./models.js";
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

function lightNode(value: unknown): LightNode {
  if (value === undefined) return "chamber_light";
  if (value === "chamber_light" || value === "work_light") return value;
  throw new Error('set_light node must be "chamber_light" or "work_light".');
}

export function writeTools(
  port: PrinterPort,
  options: { safeMode: boolean; slicerBin?: string; capabilities: Capabilities },
) {
  const { safeMode, slicerBin, capabilities } = options;
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

  const lowRisk = [
    {
      name: "set_light",
      description:
        "Turn chamber_light or work_light on or off. Allowed while safe mode is on. Missing hardware returns supported:false. Does not move the printer and does not need confirm.",
      inputSchema: z.object({
        on: z.boolean().describe("true turns the light on. false turns it off."),
        node: z
          .enum(["chamber_light", "work_light"])
          .optional()
          .describe("Defaults to chamber_light. work_light returns supported:false when this printer has no work light."),
      }),
      handler: async (args: Record<string, unknown>) => {
        guardWrite("set_light", safeMode, args.confirm);
        if (typeof args.on !== "boolean") throw new Error("set_light needs { on: boolean }.");
        const node = lightNode(args.node);
        const present = node === "work_light" ? capabilities.workLight : capabilities.chamberLight;
        if (!present) return { supported: false, on: args.on, led_node: node };
        await port.setLight(args.on, node);
        return { supported: true, on: args.on, led_node: node };
      },
    },
    {
      name: "set_camera",
      description:
        "Enable or disable camera recording and timelapse (MQTT camera.ipcam_record_set / camera.ipcam_timelapse). Settings only: no live stream and no snapshot. Allowed while safe mode is on. Missing camera returns supported:false.",
      inputSchema: z.object({
        record: z.boolean().optional().describe("true enables recording. false disables it."),
        timelapse: z.boolean().optional().describe("true enables timelapse. false disables it."),
      }),
      handler: async (args: Record<string, unknown>) => {
        guardWrite("set_camera", safeMode, args.confirm);
        const record = args.record;
        const timelapse = args.timelapse;
        if (typeof record !== "boolean" && typeof timelapse !== "boolean") {
          throw new Error("set_camera needs { record: boolean } and/or { timelapse: boolean }.");
        }
        const result: Record<string, unknown> = {};
        let applied = false;
        if (typeof record === "boolean") {
          if (!capabilities.ipcamRecord) result.record = { supported: false };
          else {
            await port.setCamera({ record });
            result.record = record ? "enable" : "disable";
            applied = true;
          }
        }
        if (typeof timelapse === "boolean") {
          if (!capabilities.timelapse) result.timelapse = { supported: false };
          else {
            await port.setCamera({ timelapse });
            result.timelapse = timelapse ? "enable" : "disable";
            applied = true;
          }
        }
        result.supported = applied;
        return result;
      },
    },
    {
      name: "set_sound",
      description:
        "Turn printer sounds on or off via print.print_option sound_enable only. Allowed while safe mode is on. Does not change detection or print-halt options and does not need confirm.",
      inputSchema: z.object({
        on: z.boolean().describe("true enables sound. false disables it."),
      }),
      handler: async (args: Record<string, unknown>) => {
        guardWrite("set_sound", safeMode, args.confirm);
        if (typeof args.on !== "boolean") throw new Error("set_sound needs { on: boolean }.");
        await port.setSound(args.on);
        return { on: args.on, sound_enable: args.on };
      },
    },
  ];

  // Grok Bot's stdio host keeps about 10 tools from tools/list. These writes are
  // already refused while safe mode is on, so leave them out of that catalog.
  // createTools registers them again when safeMode is false.
  if (safeMode) return lowRisk;

  const tools = [
    ...lowRisk,
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
        if (!capabilities.ftps) return { supported: false };
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
  ];
  return tools;
}

function readSidecar(printablePath: string) {
  const sidecar = sidecarPathFor(printablePath);
  if (!existsSync(sidecar)) return {};
  return parseSidecar(JSON.parse(readFileSync(sidecar, "utf8")));
}
