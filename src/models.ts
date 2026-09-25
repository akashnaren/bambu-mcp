/**
 * Hardware name the operator set, versus the bambu-js dialect we pass to
 * `PrinterController.create`. bambu-js 3.0.1 only accepts `P1S` and `H2D`
 * (`isSupportedModel`). X1 and A1 use the same single-nozzle MQTT print object
 * that schema models. H2S uses the H2D schema. Unknown names fail closed.
 * One process, one printer — there is no fleet map.
 */

export type Dialect = "P1S" | "H2D";

export type HardwareModel =
  | "X1"
  | "X1C"
  | "X1E"
  | "P1P"
  | "P1S"
  | "P2S"
  | "A1"
  | "A1MINI"
  | "H2D"
  | "H2S";

export interface Capabilities {
  chamberLight: boolean;
  workLight: boolean;
  chamberTempSensor: boolean;
  /** Informational. This server never exposes a chamber-heater setter. P2S is false. */
  chamberHeater: boolean;
  ams: boolean;
  ipcamRecord: boolean;
  timelapse: boolean;
  ftps: boolean;
}

/** Names accepted in `BAMBU_MODEL`, including aliases, for the fail-closed error. */
export const ACCEPTED_MODEL_NAMES = [
  "X1",
  "X1C",
  "X1E",
  "P1P",
  "P1S",
  "P2S",
  "A1",
  "A1MINI",
  "A1_MINI",
  "A1-MINI",
  "H2D",
  "H2S",
] as const;

const ALIAS: Record<string, HardwareModel> = {
  X1: "X1",
  X1C: "X1C",
  X1E: "X1E",
  P1P: "P1P",
  P1S: "P1S",
  P2S: "P2S",
  A1: "A1",
  A1MINI: "A1MINI",
  "A1-MINI": "A1MINI",
  H2D: "H2D",
  H2S: "H2S",
};

/** bambu-js dialect. Do not pass X1/A1 strings through; the library rejects them. */
const DIALECT: Record<HardwareModel, Dialect> = {
  X1: "P1S",
  X1C: "P1S",
  X1E: "P1S",
  P1P: "P1S",
  P1S: "P1S",
  P2S: "P1S",
  A1: "P1S",
  A1MINI: "P1S",
  H2D: "H2D",
  H2S: "H2D",
};

const ENCLOSED_NO_HEATER: Capabilities = {
  chamberLight: true,
  workLight: false,
  chamberTempSensor: true,
  chamberHeater: false,
  ams: true,
  ipcamRecord: true,
  timelapse: true,
  ftps: true,
};

const CAPABILITIES: Record<HardwareModel, Capabilities> = {
  X1: { ...ENCLOSED_NO_HEATER, workLight: true },
  X1C: { ...ENCLOSED_NO_HEATER, workLight: true },
  X1E: { ...ENCLOSED_NO_HEATER, workLight: true, chamberHeater: true },
  P1P: {
    chamberLight: false,
    workLight: false,
    chamberTempSensor: false,
    chamberHeater: false,
    ams: true,
    ipcamRecord: false,
    timelapse: false,
    ftps: true,
  },
  P1S: ENCLOSED_NO_HEATER,
  // P2S has no active chamber heater. Temperature rises from the bed and hotend.
  P2S: ENCLOSED_NO_HEATER,
  A1: {
    chamberLight: false,
    workLight: false,
    chamberTempSensor: false,
    chamberHeater: false,
    ams: true,
    ipcamRecord: true,
    timelapse: true,
    ftps: true,
  },
  A1MINI: {
    chamberLight: false,
    workLight: false,
    chamberTempSensor: false,
    chamberHeater: false,
    ams: true,
    ipcamRecord: true,
    timelapse: true,
    ftps: true,
  },
  H2D: {
    chamberLight: true,
    workLight: true,
    chamberTempSensor: true,
    chamberHeater: true,
    ams: true,
    ipcamRecord: true,
    timelapse: true,
    ftps: true,
  },
  H2S: {
    chamberLight: true,
    workLight: true,
    chamberTempSensor: true,
    chamberHeater: true,
    ams: true,
    ipcamRecord: true,
    timelapse: true,
    ftps: true,
  },
};

export function capabilitiesFor(hardware: HardwareModel): Capabilities {
  return { ...CAPABILITIES[hardware] };
}

function modelKey(raw: string): string {
  return raw.trim().toUpperCase().replace(/[\s_]+/g, "-");
}

/** Normalize `BAMBU_MODEL`. Throws on unknown names and lists what is accepted. */
export function normalizeModel(raw: string): { hardwareModel: HardwareModel; dialect: Dialect } {
  const key = modelKey(raw);
  const hardwareModel = ALIAS[key];
  if (!hardwareModel) {
    throw new Error(
      `BAMBU_MODEL must be one of: ${ACCEPTED_MODEL_NAMES.join(", ")} (got ${raw}).`,
    );
  }
  return { hardwareModel, dialect: DIALECT[hardwareModel] };
}
