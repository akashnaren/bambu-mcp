import { FileController, PrinterController } from "bambu-js";
import type { Config } from "./config.js";

/**
 * One printer per process: one MQTT client and one FTPS client for the life of the process.
 * status / temps / ams share the latest report for a short window
 * instead of each sending pushall. Startup does not connect.
 */

const REPORT_TTL_MS = 2_000;
const REPORT_WAIT_MS = 3_000;

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

export type ChamberLight = "on" | "off" | "flashing";
export type LightNode = "chamber_light" | "work_light";

export interface LightState {
  node: string;
  mode: string;
}

export interface IpcamFlags {
  record: string | null;
  timelapse: string | null;
}

export interface AmsHumidity {
  id: number;
  humidity: string | null;
}

export interface StatusSnapshot {
  state: string;
  percent: number | null;
  remainingMin: number | null;
  layer: number | null;
  totalLayers: number | null;
  subtask: string | null;
  /** From `lights_report` when the cached report includes it. */
  chamberLight: ChamberLight | null;
  /** Present when `lights_report` has more than one node. */
  lights: LightState[] | null;
  wifiSignal: string | null;
  /** Pass-through when the report includes a `wifi` field. Otherwise null. */
  wifi: unknown;
  printError: number | null;
  errorCode: string | null;
  /** AMS unit humidity only. Full trays stay on the `ams` tool. */
  amsHumidity: AmsHumidity[] | null;
  /** Record / timelapse flags from `ipcam`. No stream URL. */
  ipcam: IpcamFlags | null;
}

export interface VersionModule {
  name: string;
  hwVer: string | null;
  swVer: string | null;
}

export interface VersionSnapshot {
  modules: VersionModule[];
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
  /** MQTT `info.get_version`. Module hw/sw only (no serial numbers). */
  getVersion(): Promise<VersionSnapshot>;
  /** MQTT `system.ledctrl` for `chamber_light` or `work_light`. */
  setLight(on: boolean, node?: LightNode): Promise<void>;
  /** MQTT `camera.ipcam_record_set` / `camera.ipcam_timelapse`. Settings only. */
  setCamera(options: { record?: boolean; timelapse?: boolean }): Promise<void>;
  /** MQTT `print.print_option` with `sound_enable` only. */
  setSound(on: boolean): Promise<void>;
}

/**
 * OpenBambuAPI `system.ledctrl`, same shape as bambu-js `setLedCommand`.
 * Timing fields are only used for flashing, but the printer requires them on plain on/off as well.
 * `node` defaults to `chamber_light`. bambu-js types `work_light` on H2D only; we send the
 * documented JSON directly so an X1 (P1S dialect) can still address a work light.
 */
export function chamberLightPayload(on: boolean, sequenceId: string, node: LightNode = "chamber_light") {
  return {
    system: {
      sequence_id: sequenceId,
      command: "ledctrl" as const,
      led_node: node,
      led_mode: on ? ("on" as const) : ("off" as const),
      led_on_time: 500,
      led_off_time: 500,
      loop_times: 1,
      interval_time: 1000,
    },
  };
}

/**
 * OpenBambuAPI `info.get_version`. Same object as bambu-js `getVersionCommand`,
 * with this client's sequence id instead of a hardcoded `"0"`.
 */
export function getVersionPayload(sequenceId: string) {
  return {
    info: {
      sequence_id: sequenceId,
      command: "get_version" as const,
    },
  };
}

/** OpenBambuAPI `camera.ipcam_record_set` / `camera.ipcam_timelapse`. `control` is enable|disable. */
export function cameraControlPayload(
  command: "ipcam_record_set" | "ipcam_timelapse",
  enable: boolean,
  sequenceId: string,
) {
  return {
    camera: {
      sequence_id: sequenceId,
      command,
      control: enable ? ("enable" as const) : ("disable" as const),
    },
  };
}

/**
 * OpenBambuAPI `print.print_option` with only `sound_enable`.
 * Detector and print-halt keys are never set here.
 */
export function soundEnablePayload(on: boolean, sequenceId: string) {
  return {
    print: {
      sequence_id: sequenceId,
      command: "print_option" as const,
      sound_enable: on,
    },
  };
}

function textOrNull(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/** Drop module serial numbers. Empty hw/sw strings become null. */
export function modulesFrom(info: unknown): VersionModule[] {
  if (!info || typeof info !== "object") return [];
  const rows = (info as { module?: unknown }).module;
  if (!Array.isArray(rows)) return [];
  const modules: VersionModule[] = [];
  for (const entry of rows) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as { name?: unknown; hw_ver?: unknown; sw_ver?: unknown };
    if (typeof row.name !== "string" || row.name === "") continue;
    modules.push({
      name: row.name,
      hwVer: textOrNull(row.hw_ver),
      swVer: textOrNull(row.sw_ver),
    });
  }
  return modules;
}

type Mqtt = PrinterController<any>;

function hex6(color: unknown): string | null {
  if (typeof color !== "string" || color.length < 6) return null;
  return `#${color.slice(0, 6).toUpperCase()}`;
}

/** Chamber light from a cached `print` report, or null when `lights_report` has no chamber node. */
export function chamberLightFrom(report: PrintReport): ChamberLight | null {
  const lights = report.lights_report;
  if (!Array.isArray(lights)) return null;
  for (const entry of lights) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as { node?: unknown; mode?: unknown };
    if (row.node !== "chamber_light") continue;
    if (row.mode === "on" || row.mode === "off" || row.mode === "flashing") return row.mode;
    return null;
  }
  return null;
}

function lightsFrom(report: PrintReport): LightState[] | null {
  const lights = report.lights_report;
  if (!Array.isArray(lights) || lights.length < 2) return null;
  const parsed: LightState[] = [];
  for (const entry of lights) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as { node?: unknown; mode?: unknown };
    if (typeof row.node !== "string" || row.node === "") continue;
    parsed.push({ node: row.node, mode: typeof row.mode === "string" ? row.mode : "" });
  }
  return parsed.length > 1 ? parsed : null;
}

function amsHumidityFrom(report: PrintReport): AmsHumidity[] | null {
  const ams = report.ams;
  if (!ams || typeof ams !== "object") return null;
  const units = (ams as { ams?: unknown }).ams;
  if (!Array.isArray(units)) return null;
  const summary: AmsHumidity[] = [];
  for (const unit of units) {
    if (!unit || typeof unit !== "object") continue;
    const row = unit as { id?: unknown; humidity?: unknown };
    const id = Number(row.id);
    if (!Number.isFinite(id)) continue;
    summary.push({ id, humidity: typeof row.humidity === "string" ? row.humidity : null });
  }
  return summary;
}

function ipcamFrom(report: PrintReport): IpcamFlags | null {
  const ipcam = report.ipcam;
  if (!ipcam || typeof ipcam !== "object") return null;
  const row = ipcam as { ipcam_record?: unknown; timelapse?: unknown };
  return {
    record: typeof row.ipcam_record === "string" ? row.ipcam_record : null,
    timelapse: typeof row.timelapse === "string" ? row.timelapse : null,
  };
}

function printErrorFrom(report: PrintReport): number | null {
  const value = report.print_error;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function errorCodeFrom(report: PrintReport): string | null {
  const value = report.mc_print_error_code;
  if (typeof value === "string" && value !== "") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

export function statusFrom(report: PrintReport): StatusSnapshot {
  return {
    state: report.gcode_state ?? "UNKNOWN",
    percent: report.mc_percent ?? null,
    remainingMin: report.mc_remaining_time ?? null,
    layer: report.layer_num ?? null,
    totalLayers: report.total_layer_num ?? null,
    subtask: report.subtask_name ?? null,
    chamberLight: chamberLightFrom(report),
    lights: lightsFrom(report),
    wifiSignal: typeof report.wifi_signal === "string" ? report.wifi_signal : null,
    wifi: report.wifi !== undefined ? report.wifi : null,
    printError: printErrorFrom(report),
    errorCode: errorCodeFrom(report),
    amsHumidity: amsHumidityFrom(report),
    ipcam: ipcamFrom(report),
  };
}

function tempsFrom(report: PrintReport): TempsSnapshot {
  return {
    nozzleC: report.nozzle_temper ?? null,
    nozzleTargetC: report.nozzle_target_temper ?? null,
    bedC: report.bed_temper ?? null,
    bedTargetC: report.bed_target_temper ?? null,
    chamberC: report.chamber_temper ?? null,
  };
}

function amsFrom(report: PrintReport): AmsSnapshot {
  const ams = report.ams as { ams?: unknown[]; tray_now?: unknown } | undefined;
  const activeSlot = ams?.tray_now != null ? Number(ams.tray_now) : null;
  const units: AmsUnit[] = ((ams?.ams ?? []) as Record<string, unknown>[]).map((unit) => ({
    id: Number(unit.id),
    humidity: (unit.humidity as string | undefined) ?? null,
    tempC: (unit.temp as string | undefined) ?? null,
    slots: ((unit.tray as Record<string, unknown>[]) ?? []).map((tray) => ({
      slot: Number(tray.id),
      type: (tray.tray_type as string) || null,
      colorHex: hex6(tray.tray_color),
      nozzleMinC: tray.nozzle_temp_min ? Number(tray.nozzle_temp_min) : null,
      nozzleMaxC: tray.nozzle_temp_max ? Number(tray.nozzle_temp_max) : null,
      active: activeSlot != null && Number(tray.id) === activeSlot,
    })),
  }));
  return { units, activeSlot };
}

export class BambuLanClient implements PrinterPort {
  private mqttClient: Mqtt | null = null;
  private opening: Promise<void> | null = null;
  private latest: PrintReport = {};
  private reportAt = 0;
  private pendingReport: Promise<PrintReport> | null = null;
  private waiters: Array<() => void> = [];
  private seq = 0;
  private versionWaiters: Array<(info: unknown) => void> = [];

  private ftpClient: FileController | null = null;
  private ftpTail: Promise<void> = Promise.resolve();

  constructor(private readonly cfg: Config) {}

  private nextSeq(): string {
    this.seq += 1;
    return String(this.seq);
  }

  /** One client for the process. Connect on demand. Never open a second client or a retry loop. */
  private session(): Mqtt {
    if (this.mqttClient) return this.mqttClient;
    const client = PrinterController.create({
      model: this.cfg.model,
      host: this.cfg.ip,
      accessCode: this.cfg.accessCode,
      serial: this.cfg.serial,
      options: { autoReconnect: false },
    }) as Mqtt;
    client.on("report", (state: { print?: PrintReport }) => {
      // bambu-js emits the whole report JSON. `info.get_version` arrives beside `print`, not inside it.
      const info = (state as { info?: { command?: unknown } } | undefined)?.info;
      if (info?.command === "get_version") {
        const waiting = this.versionWaiters;
        this.versionWaiters = [];
        for (const wake of waiting) wake(info);
      }
      if (!state?.print) return;
      this.latest = { ...this.latest, ...state.print };
      this.reportAt = Date.now();
      const waiting = this.waiters;
      this.waiters = [];
      for (const wake of waiting) wake();
    });
    client.on("error", () => undefined);
    this.mqttClient = client;
    return client;
  }

  private async mqtt(): Promise<Mqtt> {
    const client = this.session();
    if (client.isConnected) return client;
    if (!this.opening) {
      this.opening = client.connect().finally(() => {
        this.opening = null;
      });
    }
    await this.opening;
    return client;
  }

  private async send(payload: Record<string, unknown>): Promise<void> {
    const client = await this.mqtt();
    await client.sendCommand(payload);
  }

  private fresh(): boolean {
    return this.reportAt > 0 && Date.now() - this.reportAt < REPORT_TTL_MS;
  }

  /** One in-flight pushall. Callers that arrive while it is running share the result. */
  private async report(): Promise<PrintReport> {
    await this.mqtt();
    if (this.fresh()) return this.latest;
    this.pendingReport ??= this.pushAll().finally(() => {
      this.pendingReport = null;
    });
    return this.pendingReport;
  }

  private pushAll(): Promise<PrintReport> {
    return new Promise((resolve) => {
      let settled = false;
      let timer: NodeJS.Timeout;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.waiters = this.waiters.filter((wake) => wake !== finish);
        resolve(this.latest);
      };
      timer = setTimeout(finish, REPORT_WAIT_MS);
      this.waiters.push(finish);
      void this.send({
        pushing: { command: "pushall", sequence_id: this.nextSeq(), version: 1, push_target: 1 },
      }).catch(finish);
    });
  }

  async status(): Promise<StatusSnapshot> {
    return statusFrom(await this.report());
  }

  async getVersion(): Promise<VersionSnapshot> {
    await this.mqtt();
    const info = await new Promise<unknown>((resolve, reject) => {
      let settled = false;
      let timer: NodeJS.Timeout;
      const finish = (payload: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(payload);
      };
      timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        this.versionWaiters = this.versionWaiters.filter((wake) => wake !== finish);
        reject(new Error("get_version timed out waiting for the printer report."));
      }, REPORT_WAIT_MS);
      this.versionWaiters.push(finish);
      void this.send(getVersionPayload(this.nextSeq())).catch((error: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.versionWaiters = this.versionWaiters.filter((wake) => wake !== finish);
        reject(error);
      });
    });
    return { modules: modulesFrom(info) };
  }

  async temps(): Promise<TempsSnapshot> {
    return tempsFrom(await this.report());
  }

  async ams(): Promise<AmsSnapshot> {
    return amsFrom(await this.report());
  }

  private ftp(): FileController {
    if (this.ftpClient) return this.ftpClient;
    const ftp = FileController.create({
      host: this.cfg.ip,
      accessCode: this.cfg.accessCode,
    });
    ftp.on("error", () => undefined);
    this.ftpClient = ftp;
    return ftp;
  }

  /** Run FTPS work one at a time on the same login. A failure drops the socket; the next call connects once. */
  private useFtp<T>(fn: (ftp: FileController) => Promise<T>): Promise<T> {
    const task = this.ftpTail.then(async () => {
      const ftp = this.ftp();
      if (!ftp.isConnected) await ftp.connect();
      try {
        return await fn(ftp);
      } catch (error) {
        await ftp.disconnect().catch(() => undefined);
        throw error;
      }
    });
    this.ftpTail = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  }

  async listFiles(dir = "/"): Promise<string[]> {
    return this.useFtp(async (ftp) => {
      const entries = await ftp.listDir(dir);
      return entries.map((entry) => entry.name);
    });
  }

  async upload(localPath: string, remoteName: string): Promise<void> {
    const remote = remoteName.startsWith("/") ? remoteName : `/${remoteName}`;
    await this.useFtp((ftp) => ftp.uploadFile(localPath, remote));
  }

  async pause(): Promise<void> {
    await this.send({ print: { command: "pause", sequence_id: this.nextSeq() } });
  }

  async resume(): Promise<void> {
    await this.send({ print: { command: "resume", sequence_id: this.nextSeq() } });
  }

  async stop(): Promise<void> {
    await this.send({ print: { command: "stop", sequence_id: this.nextSeq() } });
  }

  async setLight(on: boolean, node: LightNode = "chamber_light"): Promise<void> {
    await this.send(chamberLightPayload(on, this.nextSeq(), node));
  }

  async setCamera(options: { record?: boolean; timelapse?: boolean }): Promise<void> {
    if (typeof options.record === "boolean") {
      await this.send(cameraControlPayload("ipcam_record_set", options.record, this.nextSeq()));
    }
    if (typeof options.timelapse === "boolean") {
      await this.send(cameraControlPayload("ipcam_timelapse", options.timelapse, this.nextSeq()));
    }
  }

  async setSound(on: boolean): Promise<void> {
    await this.send(soundEnablePayload(on, this.nextSeq()));
  }

  async startPrint(options: StartPrintOptions): Promise<void> {
    await this.send({
      print: {
        command: "project_file",
        param: `Metadata/plate_${options.plate}.gcode`,
        url: `ftp:///${options.remoteName}`,
        subtask_name: options.remoteName.replace(/\.[^.]+$/, ""),
        use_ams: options.useAms,
        ams_mapping: options.useAms ? options.amsMapping : [255],
        timelapse: options.timelapse,
        flow_cali: options.flowCali,
        bed_leveling: options.bedLeveling,
        layer_inspect: options.layerInspect,
        vibration_cali: options.vibrationCali,
        bed_type: options.bedType,
        sequence_id: this.nextSeq(),
        project_id: "0",
        profile_id: "0",
        task_id: "0",
        subtask_id: "0",
      },
    });
  }
}
