import { z } from "zod";
import { guard } from "../gate.js";
import { bind, type ToolDef } from "../types.js";

export const setSound: ToolDef = {
  name: "set_sound",
  gate: "safe_write_low_risk",
  create(ctx) {
    return bind(setSound, {
      description:
        "Turn printer sounds on or off via print.print_option sound_enable only. Allowed while safe mode is on. Does not change detection or print-halt options and does not need confirm.",
      inputSchema: z.object({
        on: z.boolean().describe("true enables sound. false disables it."),
      }),
      handler: async (args) => {
        guard(setSound.name, setSound.gate, ctx.safeMode, args.confirm);
        if (typeof args.on !== "boolean") throw new Error("set_sound needs { on: boolean }.");
        await ctx.port.setSound(args.on);
        return { on: args.on, sound_enable: args.on };
      },
    });
  },
};
