import { z } from "zod";
import type { LightNode } from "../../client.js";
import { guard } from "../gate.js";
import { bind, type ToolDef } from "../types.js";

function lightNode(value: unknown): LightNode {
  if (value === undefined) return "chamber_light";
  if (value === "chamber_light" || value === "work_light") return value;
  throw new Error('set_light node must be "chamber_light" or "work_light".');
}

export const setLight: ToolDef = {
  name: "set_light",
  gate: "safe_write_low_risk",
  create(ctx) {
    return bind(setLight, {
      description:
        "Turn chamber_light or work_light on or off. Allowed while safe mode is on. Missing hardware returns supported:false. Does not move the printer and does not need confirm.",
      inputSchema: z.object({
        on: z.boolean().describe("true turns the light on. false turns it off."),
        node: z
          .enum(["chamber_light", "work_light"])
          .optional()
          .describe(
            "Defaults to chamber_light. work_light returns supported:false when this printer has no work light.",
          ),
      }),
      handler: async (args) => {
        guard(setLight.name, setLight.gate, ctx.safeMode, args.confirm);
        if (typeof args.on !== "boolean") throw new Error("set_light needs { on: boolean }.");
        const node = lightNode(args.node);
        const present = node === "work_light" ? ctx.capabilities.workLight : ctx.capabilities.chamberLight;
        if (!present) return { supported: false, on: args.on, led_node: node };
        await ctx.port.setLight(args.on, node);
        return { supported: true, on: args.on, led_node: node };
      },
    });
  },
};
