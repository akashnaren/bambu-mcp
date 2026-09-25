import { z } from "zod";
import type { PrinterPort } from "./client.js";
import type { Capabilities } from "./models.js";

const none = z.object({});

export function readTools(port: PrinterPort, capabilities: Capabilities, safeMode: boolean) {
  return [
    {
      name: "status",
      description:
        "Read print state: gcode_state, progress, remaining minutes, layer, job, chamber light, and any wifi, error, multi-node light, or camera flags already in the report. Includes safeMode.",
      inputSchema: none,
      handler: async () => ({ ...(await port.status()), safeMode }),
    },
    {
      name: "temps",
      description: "Read nozzle, bed, and chamber temperatures in °C. Chamber is null when this printer has no chamber sensor.",
      inputSchema: none,
      handler: async () => {
        const temps = await port.temps();
        if (!capabilities.chamberTempSensor) return { ...temps, chamberC: null };
        return temps;
      },
    },
    {
      name: "ams",
      description: "Read AMS units, filament slots, and the active slot.",
      inputSchema: none,
      handler: async () => {
        if (!capabilities.ams) return { supported: false, units: [], activeSlot: null };
        return port.ams();
      },
    },
    {
      name: "list_files",
      description: "List files on the printer FTPS cache.",
      inputSchema: z.object({
        dir: z.string().optional().describe("Remote directory. Default /"),
      }),
      handler: async (args: Record<string, unknown>) => {
        if (!capabilities.ftps) return { supported: false, files: [] };
        return { files: await port.listFiles(typeof args.dir === "string" ? args.dir : "/") };
      },
    },
    {
      name: "get_version",
      description: "Read module hardware and software versions (MQTT info.get_version). Serial numbers are omitted.",
      inputSchema: none,
      handler: async () => port.getVersion(),
    },
  ];
}
