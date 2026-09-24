import { z } from "zod";
import type { PrinterPort } from "./client.js";
import { readTools } from "./reads.js";
import { writeTools } from "./writes.js";

export interface Tool {
  name: string;
  description: string;
  inputSchema: z.ZodObject<z.ZodRawShape>;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}

export function createTools(
  port: PrinterPort,
  options?: { safeMode?: boolean; slicerBin?: string },
): Tool[] {
  const safeMode = options?.safeMode ?? true;
  return [...readTools(port, safeMode), ...writeTools(port, { safeMode, slicerBin: options?.slicerBin })];
}
