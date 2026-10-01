import type { PrinterPort } from "../client.js";
import { capabilitiesFor, type Capabilities } from "../models.js";
import { upload } from "./files/upload.js";
import { sliceHook } from "./files/slice_hook.js";
import { guard, type ToolGate } from "./gate.js";
import { pause } from "./motion/pause.js";
import { print } from "./motion/print.js";
import { resume } from "./motion/resume.js";
import { stop } from "./motion/stop.js";
import { ams } from "./read/ams.js";
import { getVersion } from "./read/get_version.js";
import { listFiles } from "./read/list_files.js";
import { status } from "./read/status.js";
import { temps } from "./read/temps.js";
import { setCamera } from "./settings/set_camera.js";
import { setLight } from "./settings/set_light.js";
import { setSound } from "./settings/set_sound.js";
import type { Tool, ToolContext, ToolDef } from "./types.js";

export type { Tool, ToolContext, ToolDef } from "./types.js";
export type { ToolGate } from "./gate.js";
export { guard } from "./gate.js";

/** The only list of tools. Order is the MCP catalog order. */
export const catalog: readonly ToolDef[] = [
  status,
  temps,
  ams,
  listFiles,
  getVersion,
  setLight,
  setCamera,
  setSound,
  upload,
  print,
  pause,
  resume,
  stop,
  sliceHook,
];

const ALWAYS = new Set<ToolGate>(["read", "safe_write_low_risk"]);

export function toolGate(name: string): ToolGate {
  return catalog.find((tool) => tool.name === name)?.gate ?? "read";
}

/** Lookup by MCP name. Handlers call `guard` with their own gate instead. */
export function guardWrite(name: string, safeMode: boolean, confirm: unknown): void {
  guard(name, toolGate(name), safeMode, confirm);
}

/**
 * Some stdio hosts keep about 10 tools from `tools/list`.
 * Safe mode registers only `read` and `safe_write_low_risk` so that catalog
 * can show them. `write` and `motion` come back when safe mode is off.
 */
export function createTools(
  port: PrinterPort,
  options?: { safeMode?: boolean; slicerBin?: string; capabilities?: Capabilities },
): Tool[] {
  const ctx: ToolContext = {
    port,
    safeMode: options?.safeMode ?? true,
    capabilities: options?.capabilities ?? capabilitiesFor("P1S"),
    slicerBin: options?.slicerBin,
  };
  return catalog
    .filter((tool) => !ctx.safeMode || ALWAYS.has(tool.gate))
    .map((tool) => tool.create(ctx));
}
