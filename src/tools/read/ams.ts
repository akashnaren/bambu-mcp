import { bind, type ToolDef } from "../types.js";
import { noArgs } from "../schema.js";

export const ams: ToolDef = {
  name: "ams",
  gate: "read",
  create(ctx) {
    return bind(ams, {
      description: "Read AMS units, filament slots, and the active slot.",
      inputSchema: noArgs,
      handler: async () => {
        if (!ctx.capabilities.ams) return { supported: false, units: [], activeSlot: null };
        return ctx.port.ams();
      },
    });
  },
};
