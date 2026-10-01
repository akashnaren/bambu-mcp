import { z } from "zod";
import { guard } from "../gate.js";
import { blockedNote, confirmField } from "../schema.js";
import { bind, type ToolDef } from "../types.js";

export const stop: ToolDef = {
  name: "stop",
  gate: "motion",
  create(ctx) {
    return bind(stop, {
      description: `Cancel the running print. ${blockedNote}`,
      inputSchema: z.object({ confirm: confirmField }),
      handler: async (args) => {
        guard(stop.name, stop.gate, ctx.safeMode, args.confirm);
        await ctx.port.stop();
        return { ok: "stopped", confirmed: true };
      },
    });
  },
};
