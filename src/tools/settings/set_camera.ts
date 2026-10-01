import { z } from "zod";
import { guard } from "../gate.js";
import { bind, type ToolDef } from "../types.js";

export const setCamera: ToolDef = {
  name: "set_camera",
  gate: "safe_write_low_risk",
  create(ctx) {
    return bind(setCamera, {
      description:
        "Enable or disable camera recording and timelapse (MQTT camera.ipcam_record_set / camera.ipcam_timelapse). Settings only: no live stream and no snapshot. Allowed while safe mode is on. Missing camera returns supported:false.",
      inputSchema: z.object({
        record: z.boolean().optional().describe("true enables recording. false disables it."),
        timelapse: z.boolean().optional().describe("true enables timelapse. false disables it."),
      }),
      handler: async (args) => {
        guard(setCamera.name, setCamera.gate, ctx.safeMode, args.confirm);
        const record = args.record;
        const timelapse = args.timelapse;
        if (typeof record !== "boolean" && typeof timelapse !== "boolean") {
          throw new Error("set_camera needs { record: boolean } and/or { timelapse: boolean }.");
        }
        const result: Record<string, unknown> = {};
        let applied = false;
        if (typeof record === "boolean") {
          if (!ctx.capabilities.ipcamRecord) result.record = { supported: false };
          else {
            await ctx.port.setCamera({ record });
            result.record = record ? "enable" : "disable";
            applied = true;
          }
        }
        if (typeof timelapse === "boolean") {
          if (!ctx.capabilities.timelapse) result.timelapse = { supported: false };
          else {
            await ctx.port.setCamera({ timelapse });
            result.timelapse = timelapse ? "enable" : "disable";
            applied = true;
          }
        }
        result.supported = applied;
        return result;
      },
    });
  },
};
