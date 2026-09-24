import type { PrinterPort, StartPrintOptions } from "./client.js";

/** In-memory printer for tests and `BAMBU_MOCK=1`. Never opens a socket. */
export class MockPrinter implements PrinterPort {
  files = new Set<string>(["bracket-left-r1.gcode.3mf"]);
  started: StartPrintOptions[] = [];
  commands: string[] = [];
  state = "IDLE";

  async status() {
    return {
      state: this.state,
      percent: 0,
      remainingMin: null,
      layer: null,
      totalLayers: null,
      subtask: null,
    };
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
}
