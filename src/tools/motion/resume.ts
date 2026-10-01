import { z } from "zod";
import { guard } from "../gate.js";
import { blockedNote, confirmField } from "../schema.js";
import { bind, type ToolDef } from "../types.js";

export const resume: ToolDef = {
  name: "resume",
  gate: "motion",
  create(ctx) {
    return bind(resume, {
      description: `Resume a paused print. ${blockedNote}`,
      inputSchema: z.object({ confirm: confirmField }),
      handler: async (args) => {
        guard(resume.name, resume.gate, ctx.safeMode, args.confirm);
        await ctx.port.resume();
        return { ok: "resumed", confirmed: true };
      },
    });
  },
};
