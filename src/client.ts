import { FileController, PrinterController } from "bambu-js";
import type {
  AmsSnapshot,
  AmsUnit,
  Config,
  PrintReport,
  PrinterPort,
  StartPrintOptions,
  StatusSnapshot,
  TempsSnapshot,
} from "./types.js";

/**
 * LAN client wrapping community bambu-js (MQTT :8883 + implicit FTPS :990).
 *
 * bambu-js is push-based: connect, cache `report` events, `sendCommand` for
 * writes. P2S has no typed schema — use BAMBU_MODEL=P1S and the community
 * X1/P1 `project_file` / pause / resume / stop payloads (same family Home
 * Assistant and OrcaSlicer use). Do not invent a new protocol.
 */

export interface LanClientDeps {
  PrinterController: typeof PrinterController;
  FileController: typeof FileController;
}

function hex6(color: unknown): string | null {
  if (typeof color !== "string" || color.length < 6) return null;
  return `#${color.slice(0, 6).toUpperCase()}`;
}

export class BambuLanClient implements PrinterPort {
  private controller: PrinterController<any> | null = null;
  private latest: PrintReport = {};
  private seq = 0;

  constructor(
    private readonly cfg: Config,
    private readonly deps: LanClientDeps = { PrinterController, FileController },
  ) {}

  private nextSeq(): string {
    this.seq += 1;
    return String(this.seq);
  }

  private async mqtt(): Promise<PrinterController<any>> {
    if (this.controller?.isConnected) return this.controller;

    const controller = this.deps.PrinterController.create({
      model: this.cfg.model as any,
      host: this.cfg.ip,
      accessCode: this.cfg.accessCode,
      serial: this.cfg.serial,
      options: { autoReconnect: true },
    });

    controller.on("report", (state: { print?: PrintReport }) => {
      if (state?.print) this.latest = { ...this.latest, ...state.print };
    });

    await controller.connect();
    this.controller = controller;
    return controller;
  }

  private async send(payload: Record<string, unknown>): Promise<void> {
    const controller = await this.mqtt();
    await controller.sendCommand(payload);
  }

  async refreshReport(timeoutMs = 3000): Promise<PrintReport> {
    const controller = await this.mqtt();
    const got = new Promise<void>((resolve) => {
      const onReport = () => {
        controller.off("report", onReport);
        resolve();
      };
      controller.on("report", onReport);
      setTimeout(() => {
        controller.off("report", onReport);
        resolve();
      }, timeoutMs);
    });
    await controller.sendCommand({
      pushing: {
        command: "pushall",
        sequence_id: this.nextSeq(),
        version: 1,
        push_target: 1,
      },
    });
    await got;
    return this.latest;
  }

  async status(): Promise<StatusSnapshot> {
    const report = await this.refreshReport();
    return {
      state: report.gcode_state ?? "UNKNOWN",
      percent: report.mc_percent ?? null,
      remainingMin: report.mc_remaining_time ?? null,
      layer: report.layer_num ?? null,
      totalLayers: report.total_layer_num ?? null,
      subtask: report.subtask_name ?? null,
    };
  }

  async temps(): Promise<TempsSnapshot> {
    const report = await this.refreshReport();
    return {
      nozzleC: report.nozzle_temper ?? null,
      nozzleTargetC: report.nozzle_target_temper ?? null,
      bedC: report.bed_temper ?? null,
      bedTargetC: report.bed_target_temper ?? null,
      chamberC: report.chamber_temper ?? null,
    };
  }

  async ams(): Promise<AmsSnapshot> {
    const report = await this.refreshReport();
    const ams = report.ams as
      | { ams?: unknown[]; tray_now?: unknown }
      | undefined;
    const raw = ams?.ams ?? [];
    const activeSlot = ams?.tray_now != null ? Number(ams.tray_now) : null;
    const units: AmsUnit[] = (raw as Record<string, unknown>[]).map((unit) => ({
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

  async pause(): Promise<void> {
    await this.send({ print: { command: "pause", sequence_id: this.nextSeq() } });
  }

  async resume(): Promise<void> {
    await this.send({ print: { command: "resume", sequence_id: this.nextSeq() } });
  }

  async stop(): Promise<void> {
    await this.send({ print: { command: "stop", sequence_id: this.nextSeq() } });
  }

  /**
   * Community LAN `project_file` payload. File must already be on FTPS cache.
   * Verified against P1-family MQTT; treat P2S start-print as the same dialect.
   */
  async startPrint(options: StartPrintOptions): Promise<void> {
    const base = options.remoteName.replace(/\.[^.]+$/, "");
    const mapping = options.useAms ? options.amsMapping : [255];
    await this.send({
      print: {
        command: "project_file",
        param: `Metadata/plate_${options.plate}.gcode`,
        url: `ftp:///${options.remoteName}`,
        subtask_name: base,
        use_ams: options.useAms,
        ams_mapping: mapping,
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

  private async withFtp<T>(fn: (ftp: FileController) => Promise<T>): Promise<T> {
    const ftp = this.deps.FileController.create({
      host: this.cfg.ip,
      accessCode: this.cfg.accessCode,
    });
    await ftp.connect();
    try {
      return await fn(ftp);
    } finally {
      await ftp.disconnect().catch(() => undefined);
    }
  }

  async listFiles(dir = "/"): Promise<string[]> {
    return this.withFtp(async (ftp) => {
      const entries = await ftp.listDir(dir);
      return entries.map((entry) => entry.name);
    });
  }

  async upload(localPath: string, remoteName: string): Promise<void> {
    const remote = remoteName.startsWith("/") ? remoteName : `/${remoteName}`;
    await this.withFtp((ftp) => ftp.uploadFile(localPath, remote));
  }
}
