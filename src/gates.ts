const WRITES = new Set(["upload", "print", "pause", "resume", "stop", "slice_hook"]);
const MOTION = new Set(["print", "pause", "resume", "stop"]);
/**
 * Light, camera record/timelapse, and sound. Allowed while safe mode is on.
 * No confirm. Keep out of WRITES and MOTION so safe mode does not block them.
 */
const SAFE_WRITE_LOW_RISK = new Set(["set_light", "set_camera", "set_sound"]);

export type ToolGate = "read" | "safe_write_low_risk" | "write" | "motion";

/** Motion is checked first: those tools are also writes, and they need confirm. */
export function toolGate(tool: string): ToolGate {
  if (MOTION.has(tool)) return "motion";
  if (WRITES.has(tool)) return "write";
  if (SAFE_WRITE_LOW_RISK.has(tool)) return "safe_write_low_risk";
  return "read";
}

export function assertSafeMode(tool: string, safeMode: boolean): void {
  if (!safeMode || !WRITES.has(tool)) return;
  throw new Error(
    `${tool} is blocked by safe mode. BAMBU_SAFE_MODE defaults to 1. ` +
      `Set BAMBU_SAFE_MODE=0 to unlock write tools. ` +
      `Write tools still require confirm: true plus an explicit human ask. Never auto-confirm.`,
  );
}

export function assertConfirmed(tool: string, confirm: unknown): void {
  if (!MOTION.has(tool) || confirm === true) return;
  throw new Error(
    `${tool} is confirm-gated. Ask the operator, then retry with confirm: true. Never set confirm yourself.`,
  );
}

/** Safe mode first, then confirm. Confirm does not unlock safe mode. */
export function guardWrite(tool: string, safeMode: boolean, confirm: unknown): void {
  assertSafeMode(tool, safeMode);
  assertConfirmed(tool, confirm);
}
