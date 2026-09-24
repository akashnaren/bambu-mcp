import { z } from "zod";
import type { PrinterPort } from "./client.js";

const none = z.object({});

export function readTools(port: PrinterPort, safeMode: boolean) {
  return [
    {
      name: "status",
      description: "Read print state: gcode_state, progress, remaining minutes, layer, job. Includes safeMode.",
      inputSchema: none,
      handler: async () => ({ ...(await port.status()), safeMode }),
    },
    {
      name: "temps",
      description: "Read nozzle, bed, and chamber temperatures in °C.",
      inputSchema: none,
      handler: async () => port.temps(),
    },
    {
      name: "ams",
      description: "Read AMS units, filament slots, and the active slot.",
      inputSchema: none,
      handler: async () => port.ams(),
    },
    {
      name: "list_files",
      description: "List files on the printer FTPS cache.",
      inputSchema: z.object({
        dir: z.string().optional().describe("Remote directory. Default /"),
      }),
      handler: async (args: Record<string, unknown>) => ({
        files: await port.listFiles(typeof args.dir === "string" ? args.dir : "/"),
      }),
    },
  ];
}
