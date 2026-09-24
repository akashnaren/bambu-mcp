/** Read tools that stay available while safe mode is on. */
export const READ_TOOL_NAMES = [
  "status",
  "temps",
  "ams",
  "list_files",
  "capabilities",
] as const;

/** Tools that upload, slice, or move the printer. Blocked while safe mode is on. */
export const WRITE_TOOL_NAMES = [
  "upload",
  "print",
  "pause",
  "resume",
  "stop",
  "slice_hook",
] as const;

/** Motion tools that still require `confirm: true` after safe mode is turned off. */
export const CONFIRM_TOOL_NAMES = ["print", "pause", "resume", "stop"] as const;

const WRITE_TOOLS = new Set<string>(WRITE_TOOL_NAMES);

/**
 * Safe mode is on unless the operator explicitly turns it off.
 * Unset, blank, and unrecognized values stay locked.
 * Unlock values: `0`, `false`, `off`, `no`.
 */
export function parseSafeMode(raw: string | undefined): boolean {
  if (raw === undefined) return true;
  const value = raw.trim().toLowerCase();
  if (value === "" || value === "1" || value === "true" || value === "on" || value === "yes") {
    return true;
  }
  if (value === "0" || value === "false" || value === "off" || value === "no") {
    return false;
  }
  return true;
}

export function isWriteTool(name: string): boolean {
  return WRITE_TOOLS.has(name);
}

export function safeModeBlockedMessage(tool: string): string {
  return (
    `${tool} is blocked by safe mode. BAMBU_SAFE_MODE defaults to 1. ` +
    `Set BAMBU_SAFE_MODE=0 to unlock write tools. ` +
    `Write tools still require confirm: true plus an explicit human ask. Never auto-confirm.`
  );
}

/** Refuse upload / slice / motion while safe mode is on. Confirm does not bypass this. */
export function assertSafeModeAllows(tool: string, safeMode: boolean): void {
  if (!safeMode || !WRITE_TOOLS.has(tool)) return;
  throw new Error(safeModeBlockedMessage(tool));
}
