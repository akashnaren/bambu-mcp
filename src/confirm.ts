const GATED = new Set(["print", "pause", "resume", "stop"]);

/**
 * Motion-affecting tools require an explicit `confirm: true`.
 * The model must ask the operator before setting it.
 */
export function assertConfirmed(tool: string, confirm: unknown): void {
  if (!GATED.has(tool)) return;
  if (confirm === true) return;
  throw new Error(
    `${tool} is confirm-gated. Ask the operator, then retry with confirm: true. Never set confirm yourself.`,
  );
}

export function isGatedTool(name: string): boolean {
  return GATED.has(name);
}
