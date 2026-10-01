import { bind, type ToolDef } from "../types.js";
import { noArgs } from "../schema.js";

export const status: ToolDef = {
  name: "status",
  gate: "read",
  create(ctx) {
    return bind(status, {
      description:
        "Read print state: gcode_state, progress, remaining minutes, layer, job, chamber light, and any wifi, error, multi-node light, or camera flags already in the report. Includes safeMode.",
      inputSchema: noArgs,
      handler: async () => ({ ...(await ctx.port.status()), safeMode: ctx.safeMode }),
    });
  },
};
