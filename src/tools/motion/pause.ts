import { z } from "zod";
import { guard } from "../gate.js";
import { blockedNote, confirmField } from "../schema.js";
import { bind, type ToolDef } from "../types.js";

export const pause: ToolDef = {
  name: "pause",
  gate: "motion",
  create(ctx) {
    return bind(pause, {
      description: `Pause the running print. ${blockedNote}`,
      inputSchema: z.object({ confirm: confirmField }),
      handler: async (args) => {
        guard(pause.name, pause.gate, ctx.safeMode, args.confirm);
        await ctx.port.pause();
        return { ok: "paused", confirmed: true };
      },
    });
  },
};
