const WRITES = new Set(["upload", "print", "pause", "resume", "stop", "slice_hook"]);
const MOTION = new Set(["print", "pause", "resume", "stop"]);

/**
 * On unless the operator opts out.
 * Unlock values are `0`, `false`, `off`, and `no`. Anything else stays locked.
 */
export function parseSafeMode(raw: string | undefined): boolean {
  if (raw === undefined || raw.trim() === "") return true;
  const value = raw.trim().toLowerCase();
  if (value === "0" || value === "false" || value === "off" || value === "no") return false;
  return true;
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
