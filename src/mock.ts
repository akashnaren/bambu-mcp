import type {
  AmsSnapshot,
  PrinterPort,
  StartPrintOptions,
  StatusSnapshot,
  TempsSnapshot,
} from "./types.js";

/** In-memory printer for tests and `BAMBU_MOCK=1`. Never talks to a machine. */
export class MockPrinter implements PrinterPort {
  files = new Set<string>(["bracket-left-r1.gcode.3mf"]);
  started: StartPrintOptions[] = [];
  commands: string[] = [];
  printState = "IDLE";

  snapshot: StatusSnapshot = {
    state: "IDLE",
    percent: 0,
    remainingMin: null,
    layer: null,
    totalLayers: null,
    subtask: null,
  };

  tempSnapshot: TempsSnapshot = {
    nozzleC: 25,
    nozzleTargetC: 0,
    bedC: 24,
    bedTargetC: 0,
    chamberC: 23,
  };

  amsSnapshot: AmsSnapshot = {
    activeSlot: 0,
    units: [
      {
        id: 0,
        humidity: "2",
        tempC: "25",
        slots: [
          {
            slot: 0,
            type: "PLA",
            colorHex: "#00AE42",
            nozzleMinC: 190,
            nozzleMaxC: 230,
            active: true,
          },
        ],
      },
    ],
  };

  async status(): Promise<StatusSnapshot> {
    return { ...this.snapshot, state: this.printState };
  }

  async temps(): Promise<TempsSnapshot> {
    return { ...this.tempSnapshot };
  }

  async ams(): Promise<AmsSnapshot> {
    return this.amsSnapshot;
  }

  async listFiles(): Promise<string[]> {
    return [...this.files];
  }

  async upload(_localPath: string, remoteName: string): Promise<void> {
    this.files.add(remoteName.replace(/^\//, ""));
  }

  async startPrint(options: StartPrintOptions): Promise<void> {
    this.started.push(options);
    this.printState = "RUNNING";
    this.snapshot.subtask = options.remoteName;
    this.commands.push("project_file");
  }

  async pause(): Promise<void> {
    this.printState = "PAUSE";
    this.commands.push("pause");
  }

  async resume(): Promise<void> {
    this.printState = "RUNNING";
    this.commands.push("resume");
  }

  async stop(): Promise<void> {
    this.printState = "IDLE";
    this.commands.push("stop");
  }
}
