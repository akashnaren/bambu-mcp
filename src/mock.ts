import {
  modulesFrom,
  statusFrom,
  type LightNode,
  type PrintReport,
  type PrinterPort,
  type StartPrintOptions,
  type VersionModule,
} from "./client.js";

/** In-memory printer for tests and `BAMBU_MOCK=1`. Never opens a socket. */
export class MockPrinter implements PrinterPort {
  files = new Set<string>(["bracket-left-r1.gcode.3mf"]);
  started: StartPrintOptions[] = [];
  commands: string[] = [];
  state = "IDLE";
  chamberLight: "on" | "off" | "flashing" | null = null;
  /** Cached push_status. `status()` reads this through `statusFrom`. */
  report: PrintReport = { gcode_state: "IDLE", mc_percent: 0 };
  versionModules: VersionModule[] = modulesFrom({
    module: [
      { name: "ota", hw_ver: "", sw_ver: "01.01.01.00", sn: "SHOULD-NOT-LEAK" },
      { name: "mc", hw_ver: "MC07", sw_ver: "00.00.10.48", sn: "SHOULD-NOT-LEAK" },
    ],
  });

  async status() {
    return statusFrom({ ...this.report, gcode_state: this.state });
  }

  async getVersion() {
    this.commands.push("get_version");
    return { modules: this.versionModules };
  }

  async temps() {
    return { nozzleC: 25, nozzleTargetC: 0, bedC: 24, bedTargetC: 0, chamberC: 23 };
  }

  async ams() {
    return { units: [], activeSlot: null };
  }

  async listFiles() {
    return [...this.files];
  }

  async upload(_localPath: string, remoteName: string) {
    this.files.add(remoteName.replace(/^\//, ""));
    this.commands.push("upload");
  }

  async startPrint(options: StartPrintOptions) {
    this.started.push(options);
    this.state = "RUNNING";
    this.commands.push("project_file");
  }

  async pause() {
    this.state = "PAUSE";
    this.commands.push("pause");
  }

  async resume() {
    this.state = "RUNNING";
    this.commands.push("resume");
  }

  async stop() {
    this.state = "IDLE";
    this.commands.push("stop");
  }

  async setLight(on: boolean, node: LightNode = "chamber_light") {
    const mode = on ? "on" : "off";
    if (node === "chamber_light") this.chamberLight = mode;
    const lights = Array.isArray(this.report.lights_report) ? [...this.report.lights_report] : [];
    const next = lights.filter((entry) => {
      if (!entry || typeof entry !== "object") return false;
      return (entry as { node?: unknown }).node !== node;
    });
    next.push({ node, mode });
    this.report.lights_report = next;
    this.commands.push(node === "chamber_light" ? `ledctrl:${mode}` : `ledctrl:${node}:${mode}`);
  }

  async setCamera(options: { record?: boolean; timelapse?: boolean }) {
    const ipcam =
      this.report.ipcam && typeof this.report.ipcam === "object"
        ? { ...(this.report.ipcam as Record<string, unknown>) }
        : {};
    if (typeof options.record === "boolean") {
      const control = options.record ? "enable" : "disable";
      ipcam.ipcam_record = control;
      this.commands.push(`ipcam_record_set:${control}`);
    }
    if (typeof options.timelapse === "boolean") {
      const control = options.timelapse ? "enable" : "disable";
      ipcam.timelapse = control;
      this.commands.push(`ipcam_timelapse:${control}`);
    }
    this.report.ipcam = ipcam;
  }

  async setSound(on: boolean) {
    this.commands.push(`sound_enable:${on ? "true" : "false"}`);
  }
}
