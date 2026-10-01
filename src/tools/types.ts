import type { z } from "zod";
import type { PrinterPort } from "../client.js";
import type { Capabilities } from "../models.js";
import type { ToolGate } from "./gate.js";

export interface ToolContext {
  port: PrinterPort;
  capabilities: Capabilities;
  safeMode: boolean;
  slicerBin?: string;
}

export interface Tool {
  name: string;
  gate: ToolGate;
  description: string;
  inputSchema: z.ZodObject<z.ZodRawShape>;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}

/** One MCP tool. `name` and `gate` live here, not in a second list. */
export interface ToolDef {
  name: string;
  gate: ToolGate;
  create(ctx: ToolContext): Tool;
}

export function bind(def: ToolDef, fields: Omit<Tool, "name" | "gate">): Tool {
  return { name: def.name, gate: def.gate, ...fields };
}
