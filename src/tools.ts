import { z } from "zod";
import type { PrinterPort } from "./client.js";
import { capabilitiesFor, type Capabilities } from "./models.js";
import { readTools } from "./reads.js";
import { writeTools } from "./writes.js";

export interface Tool {
  name: string;
  description: string;
  inputSchema: z.ZodObject<z.ZodRawShape>;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}

/**
 * Grok Bot's stdio MCP host keeps about 10 tools from `tools/list`.
 * While `safeMode` is true this returns only tools that are allowed to run:
 * SAFE_READ (`status`, `temps`, `ams`, `list_files`, `get_version`) and
 * SAFE_WRITE_LOW_RISK (`set_light`, `set_camera`, `set_sound`). That stays
 * under 10 so the live catalog can show the demo tools.
 * Tools safe mode would refuse — `slice_hook`, `upload`, `print`, `pause`,
 * `resume`, `stop` — are omitted here. `writeTools` registers that full
 * gated set again when `safeMode` is false.
 */
export function createTools(
  port: PrinterPort,
  options?: { safeMode?: boolean; slicerBin?: string; capabilities?: Capabilities },
): Tool[] {
  const safeMode = options?.safeMode ?? true;
  const capabilities = options?.capabilities ?? capabilitiesFor("P1S");
  return [
    ...readTools(port, capabilities, safeMode),
    ...writeTools(port, { safeMode, slicerBin: options?.slicerBin, capabilities }),
  ];
}
