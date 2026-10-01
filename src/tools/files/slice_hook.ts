import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import { z } from "zod";
import { formatPrintableName, isSliceableInput, sidecarPathFor } from "../../contract.js";
import { runSlice } from "../../slice.js";
import { guard } from "../gate.js";
import { blockedNote } from "../schema.js";
import { bind, type ToolDef } from "../types.js";

export const sliceHook: ToolDef = {
  name: "slice_hook",
  gate: "write",
  create(ctx) {
    return bind(sliceHook, {
      description: `Slice an STL or mesh 3MF to {part}-{variant}-{rev}.gcode.3mf. Does not upload or print. ${blockedNote}`,
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
        guard(sliceHook.name, sliceHook.gate, ctx.safeMode, args.confirm);
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
        const result = await runSlice(ctx.slicerBin, {
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
    });
  },
};
