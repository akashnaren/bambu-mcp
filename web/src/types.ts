export interface Capabilities {
  chamberLight?: boolean;
  workLight?: boolean;
  chamberTempSensor?: boolean;
  ams?: boolean;
  ipcamRecord?: boolean;
  timelapse?: boolean;
  ftps?: boolean;
}

export interface Info {
  safeMode: boolean;
  hardwareModel: string;
  host: string;
  capabilities: Capabilities;
  tools: string[];
}

export interface LightState {
  node: string;
  mode: string;
}

export interface StatusSnapshot {
  state?: string;
  percent?: number | null;
  remainingMin?: number | null;
  layer?: number | null;
  totalLayers?: number | null;
  subtask?: string | null;
  chamberLight?: "on" | "off" | "flashing" | null;
  lights?: LightState[] | null;
  wifiSignal?: string | null;
  printError?: number | null;
  errorCode?: string | null;
  ipcam?: { record?: string | null; timelapse?: string | null } | null;
}

export interface TempsSnapshot {
  nozzleC?: number | null;
  nozzleTargetC?: number | null;
  bedC?: number | null;
  bedTargetC?: number | null;
  chamberC?: number | null;
}

export interface AmsSlot {
  slot: number;
  type?: string | null;
  colorHex?: string | null;
  active?: boolean;
}

export interface AmsUnit {
  id: number;
  slots?: AmsSlot[];
}

export interface AmsSnapshot {
  supported?: boolean;
  units?: AmsUnit[];
  activeSlot?: number | null;
}

export interface ToolResult {
  supported?: boolean;
  files?: string[];
  record?: { supported?: boolean } | string;
  timelapse?: { supported?: boolean } | string;
}
