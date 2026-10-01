import { bind, type ToolDef } from "../types.js";
import { noArgs } from "../schema.js";

export const temps: ToolDef = {
  name: "temps",
  gate: "read",
  create(ctx) {
    return bind(temps, {
      description:
        "Read nozzle, bed, and chamber temperatures in °C. Chamber is null when this printer has no chamber sensor.",
      inputSchema: noArgs,
      handler: async () => {
        const reading = await ctx.port.temps();
        if (!ctx.capabilities.chamberTempSensor) return { ...reading, chamberC: null };
        return reading;
      },
    });
  },
};
