import { FileController, PrinterController } from "bambu-js";
import type { Config } from "./config.js";

/**
 * One MQTT client and one FTPS client for the life of the process.
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

export interface StatusSnapshot {
  state: string;
  percent: number | null;
  remainingMin: number | null;
  layer: number | null;
  totalLayers: number | null;
  subtask: string | null;
  /** From `lights_report` when the cached report includes it. */
  chamberLight: ChamberLight | null;
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
  /** Chamber light only. MQTT `system.ledctrl`. */
  setLight(on: boolean): Promise<void>;
}

/**
 * OpenBambuAPI `system.ledctrl`. Timing fields are only used for flashing,
 * but the printer requires them on plain on/off as well.
 */
export function chamberLightPayload(on: boolean, sequenceId: string) {
  return {
    system: {
      sequence_id: sequenceId,
      command: "ledctrl" as const,
      led_node: "chamber_light" as const,
      led_mode: on ? ("on" as const) : ("off" as const),
      led_on_time: 500,
      led_off_time: 500,
      loop_times: 1,
      interval_time: 1000,
    },
  };
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

function statusFrom(report: PrintReport): StatusSnapshot {
  return {
    state: report.gcode_state ?? "UNKNOWN",
    percent: report.mc_percent ?? null,
    remainingMin: report.mc_remaining_time ?? null,
    layer: report.layer_num ?? null,
    totalLayers: report.total_layer_num ?? null,
    subtask: report.subtask_name ?? null,
    chamberLight: chamberLightFrom(report),
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

  async setLight(on: boolean): Promise<void> {
    await this.send(chamberLightPayload(on, this.nextSeq()));
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
