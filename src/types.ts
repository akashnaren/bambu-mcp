/** Latest `print` object from a Bambu LAN MQTT report. Keys vary by firmware. */
export interface PrintReport {
  gcode_state?: string;
  mc_percent?: number;
  mc_remaining_time?: number;
  nozzle_temper?: number;
  nozzle_target_temper?: number;
  bed_temper?: number;
  bed_target_temper?: number;
  chamber_temper?: number;
  subtask_name?: string;
  layer_num?: number;
  total_layer_num?: number;
  ams?: unknown;
  [key: string]: unknown;
}

export interface StatusSnapshot {
  state: string;
  percent: number | null;
  remainingMin: number | null;
  layer: number | null;
  totalLayers: number | null;
  subtask: string | null;
}

export interface TempsSnapshot {
  nozzleC: number | null;
  nozzleTargetC: number | null;
  bedC: number | null;
  bedTargetC: number | null;
  chamberC: number | null;
}

export interface AmsSlot {
  slot: number;
  type: string | null;
  colorHex: string | null;
  nozzleMinC: number | null;
  nozzleMaxC: number | null;
  active: boolean;
}

export interface AmsUnit {
  id: number;
  humidity: string | null;
  tempC: string | null;
  slots: AmsSlot[];
}

export interface AmsSnapshot {
  units: AmsUnit[];
  activeSlot: number | null;
}

/** Optional Imagine sidecar next to `{part}-{variant}-{rev}.gcode.3mf`. */
export interface PrintSidecar {
  part?: string;
  variant?: string;
  rev?: string;
  plate?: number;
  useAms?: boolean;
  amsMapping?: number[];
  bedType?: string;
  timelapse?: boolean;
  flowCali?: boolean;
  bedLeveling?: boolean;
  vibrationCali?: boolean;
  layerInspect?: boolean;
}

export interface StartPrintOptions {
  remoteName: string;
  plate: number;
  useAms: boolean;
  amsMapping: number[];
  bedType: string;
  timelapse: boolean;
  flowCali: boolean;
  bedLeveling: boolean;
  vibrationCali: boolean;
  layerInspect: boolean;
}

export interface PrinterPort {
  status(): Promise<StatusSnapshot>;
  temps(): Promise<TempsSnapshot>;
  ams(): Promise<AmsSnapshot>;
  listFiles(dir?: string): Promise<string[]>;
  upload(localPath: string, remoteName: string): Promise<void>;
  startPrint(options: StartPrintOptions): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  stop(): Promise<void>;
}

export interface SliceRequest {
  inputPath: string;
  outputPath: string;
  plate: number;
  settings?: string;
  filaments?: string;
  arrange: boolean;
  orient: boolean;
}

export interface SliceRunner {
  run(request: SliceRequest): Promise<{ output: string; cmd: string }>;
}

export interface Config {
  ip: string;
  accessCode: string;
  serial: string;
  /** bambu-js dialect. P2S hardware uses `P1S`. */
  model: "P1S" | "H2D";
  mock: boolean;
  /**
   * When true (the default), only read tools run.
   * `BAMBU_SAFE_MODE=0` is the intentional unlock. Motion tools still need `confirm: true`.
   */
  safeMode: boolean;
  slicerBin?: string;
}
