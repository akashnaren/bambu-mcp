export type ToolGate = "read" | "safe_write_low_risk" | "write" | "motion";

const BLOCKED = new Set<ToolGate>(["write", "motion"]);

/** Safe mode first, then confirm. Confirm does not unlock safe mode. */
export function guard(name: string, gate: ToolGate, safeMode: boolean, confirm: unknown): void {
  if (safeMode && BLOCKED.has(gate)) {
    throw new Error(
      `${name} is blocked by safe mode. BAMBU_SAFE_MODE defaults to 1. ` +
        `Set BAMBU_SAFE_MODE=0 to unlock write tools. ` +
        `Write tools still require confirm: true plus an explicit human ask. Never auto-confirm.`,
    );
  }
  if (gate === "motion" && confirm !== true) {
    throw new Error(
      `${name} is confirm-gated. Ask the operator, then retry with confirm: true. Never set confirm yourself.`,
    );
  }
}
