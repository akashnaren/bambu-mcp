import { config as loadDotenv } from "dotenv";
import {
  capabilitiesFor,
  normalizeModel,
  type Capabilities,
  type Dialect,
  type HardwareModel,
} from "./models.js";

export interface Config {
  ip: string;
  accessCode: string;
  serial: string;
  /** What `BAMBU_MODEL` named, after alias normalization (`A1-MINI` → `A1MINI`). */
  hardwareModel: HardwareModel;
  /** bambu-js dialect. Only `P1S` or `H2D`. P2S hardware uses `P1S`. */
  model: Dialect;
  capabilities: Capabilities;
  mock: boolean;
  /** True unless the operator set `BAMBU_SAFE_MODE=0`. */
  safeMode: boolean;
  slicerBin?: string;
}

loadDotenv();

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
export function parseSafeMode(raw: string | undefined): boolean {
  if (raw === undefined || raw.trim() === "") return true;
  const value = raw.trim().toLowerCase();
  if (value === "0" || value === "false" || value === "off" || value === "no") return false;
  return true;
}

/** Read printer settings from the environment. `BAMBU_MOCK=1` skips live secrets. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const mock = env.BAMBU_MOCK === "1" || env.BAMBU_MOCK === "true";
  const { hardwareModel, dialect } = normalizeModel(env.BAMBU_MODEL ?? "P1S");
  return {
    ip: mock ? env.BAMBU_IP?.trim() || "127.0.0.1" : read(env, "BAMBU_IP"),
    accessCode: mock ? env.BAMBU_ACCESS_CODE?.trim() || "mock" : read(env, "BAMBU_ACCESS_CODE"),
    serial: mock ? env.BAMBU_SERIAL?.trim() || "MOCKSERIAL00000" : read(env, "BAMBU_SERIAL"),
    hardwareModel,
    model: dialect,
    capabilities: capabilitiesFor(hardwareModel),
    mock,
    safeMode: parseSafeMode(env.BAMBU_SAFE_MODE),
    slicerBin: env.SLICER_BIN?.trim() || undefined,
  };
}
