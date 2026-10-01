import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";
import { assertPrintableArtifact, defaultPrintOptions, looksLocal, parseSidecar, sidecarPathFor } from "../../contract.js";
import { guard } from "../gate.js";
import { blockedNote, confirmField } from "../schema.js";
import { bind, type ToolDef } from "../types.js";

function readSidecar(printablePath: string) {
  const sidecar = sidecarPathFor(printablePath);
  if (!existsSync(sidecar)) return {};
  return parseSidecar(JSON.parse(readFileSync(sidecar, "utf8")));
}

export const print: ToolDef = {
  name: "print",
  gate: "motion",
  create(ctx) {
    return bind(print, {
      description: `Start printing a {part}-{variant}-{rev}.gcode.3mf. Refuses .stl, wip-*, and scratch/. ${blockedNote}`,
      inputSchema: z.object({
        file: z.string().describe("Local path or remote filename of the .gcode.3mf"),
        confirm: confirmField,
        plate: z.number().int().optional(),
        useAms: z.boolean().optional(),
        amsMapping: z.array(z.number().int()).optional(),
        alreadyUploaded: z.boolean().optional().describe("Skip FTPS upload and print the remote name."),
      }),
      handler: async (args) => {
        guard(print.name, print.gate, ctx.safeMode, args.confirm);
        const file = String(args.file);
        const artifact = assertPrintableArtifact(file);
        const local = looksLocal(file) && existsSync(file);
        const sidecar = local ? readSidecar(file) : {};
        const job = defaultPrintOptions(artifact.filename, sidecar);
        if (typeof args.plate === "number") job.plate = args.plate;
        if (typeof args.useAms === "boolean") job.useAms = args.useAms;
        if (Array.isArray(args.amsMapping)) job.amsMapping = args.amsMapping as number[];
        if (local && args.alreadyUploaded !== true) await ctx.port.upload(file, artifact.filename);
        await ctx.port.startPrint(job);
        return { printing: artifact.filename, ...job, confirmed: true };
      },
    });
  },
};
