import { existsSync } from "node:fs";
import { z } from "zod";
import { assertPrintableArtifact } from "../../contract.js";
import { guard } from "../gate.js";
import { blockedNote } from "../schema.js";
import { bind, type ToolDef } from "../types.js";

export const upload: ToolDef = {
  name: "upload",
  gate: "write",
  create(ctx) {
    return bind(upload, {
      description: `Upload a {part}-{variant}-{rev}.gcode.3mf over FTPS. Does not start a print. ${blockedNote}`,
      inputSchema: z.object({
        localPath: z.string().describe("Local path to the .gcode.3mf"),
        remoteName: z.string().optional().describe("Remote filename. Default: local basename"),
      }),
      handler: async (args) => {
        guard(upload.name, upload.gate, ctx.safeMode, args.confirm);
        const localPath = String(args.localPath);
        if (!ctx.capabilities.ftps) return { supported: false };
        if (!existsSync(localPath)) throw new Error(`No such file: ${localPath}`);
        const parsed = assertPrintableArtifact(localPath);
        const remote = args.remoteName ? String(args.remoteName) : parsed.filename;
        assertPrintableArtifact(remote);
        await ctx.port.upload(localPath, remote);
        return { uploaded: remote };
      },
    });
  },
};
