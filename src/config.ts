export interface Config {
  ip: string;
  accessCode: string;
  serial: string;
  /** bambu-js dialect. P2S hardware uses `P1S`. */
  model: "P1S" | "H2D";
  mock: boolean;
  /** True unless the operator set `BAMBU_SAFE_MODE=0`. */
  safeMode: boolean;
  slicerBin?: string;
}

function read(env: NodeJS.ProcessEnv, name: string, fallback?: string): string {
  const value = env[name] ?? fallback;
  if (value === undefined || value.trim() === "") {
    throw new Error(
      `${name} is not set. Put secrets in the environment (or a local .env) — never in tool args or git.`,
    );
  }
  return value.trim();
}

/** On unless the operator opts out. Only `0`, `false`, `off`, and `no` unlock writes. */
function parseSafeMode(raw: string | undefined): boolean {
  if (raw === undefined || raw.trim() === "") return true;
  const value = raw.trim().toLowerCase();
  if (value === "0" || value === "false" || value === "off" || value === "no") return false;
  return true;
}

function normalizeModel(raw: string): Config["model"] {
  const model = raw.toUpperCase();
  if (model === "P2S") {
    // P2S speaks the P1S-family MQTT dialect; bambu-js has no P2S schema.
    return "P1S";
  }
  if (model === "P1S" || model === "H2D") return model;
  throw new Error(`BAMBU_MODEL must be P1S, P2S, or H2D (got ${raw}). P2S hardware uses P1S.`);
}

/** Read printer settings from the environment. `BAMBU_MOCK=1` skips live secrets. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const mock = env.BAMBU_MOCK === "1" || env.BAMBU_MOCK === "true";
  return {
    ip: mock ? env.BAMBU_IP?.trim() || "127.0.0.1" : read(env, "BAMBU_IP"),
    accessCode: mock ? env.BAMBU_ACCESS_CODE?.trim() || "mock" : read(env, "BAMBU_ACCESS_CODE"),
    serial: mock ? env.BAMBU_SERIAL?.trim() || "MOCKSERIAL00000" : read(env, "BAMBU_SERIAL"),
    model: normalizeModel(env.BAMBU_MODEL ?? "P1S"),
    mock,
    safeMode: parseSafeMode(env.BAMBU_SAFE_MODE),
    slicerBin: env.SLICER_BIN?.trim() || undefined,
  };
}
