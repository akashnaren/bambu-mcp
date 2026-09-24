import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { BambuLanClient } from "../client.js";
import type { Config } from "../types.js";

class FakePrinter extends EventEmitter {
  isConnected = false;
  sent: Record<string, unknown>[] = [];

  async connect() {
    this.isConnected = true;
  }

  async sendCommand(payload: Record<string, unknown>) {
    this.sent.push(payload);
    if ((payload as { pushing?: { command?: string } }).pushing?.command === "pushall") {
      this.emit("report", {
        print: {
          gcode_state: "RUNNING",
          mc_percent: 42,
          nozzle_temper: 210,
          bed_temper: 60,
          ams: {
            tray_now: 0,
            ams: [
              {
                id: "0",
                humidity: "1",
                temp: "26",
                tray: [{ id: "0", tray_type: "PLA", tray_color: "FF0000FF" }],
              },
            ],
          },
        },
      });
    }
  }
}

class FakeFtp {
  uploaded: { local: string; remote: string }[] = [];
  async connect() {}
  async disconnect() {}
  async listDir() {
    return [{ name: "bracket-left-r1.gcode.3mf" }];
  }
  async uploadFile(local: string, remote: string) {
    this.uploaded.push({ local, remote });
  }
}

const cfg: Config = {
  ip: "192.168.1.50",
  accessCode: "00000000",
  serial: "SERIAL",
  model: "P1S",
  mock: false,
  safeMode: true,
};

describe("BambuLanClient (bambu-js mocked)", () => {
  it("pushall then maps status / temps / ams", async () => {
    const printer = new FakePrinter();
    const client = new BambuLanClient(cfg, {
      PrinterController: { create: () => printer } as any,
      FileController: { create: () => new FakeFtp() } as any,
    });

    await expect(client.status()).resolves.toMatchObject({
      state: "RUNNING",
      percent: 42,
    });
    await expect(client.temps()).resolves.toMatchObject({ nozzleC: 210, bedC: 60 });
    await expect(client.ams()).resolves.toMatchObject({
      activeSlot: 0,
      units: [{ slots: [{ type: "PLA", colorHex: "#FF0000" }] }],
    });
    expect(printer.sent[0]).toMatchObject({ pushing: { command: "pushall" } });
  });

  it("sends community pause/resume/stop and project_file payloads", async () => {
    const printer = new FakePrinter();
    const client = new BambuLanClient(cfg, {
      PrinterController: { create: () => printer } as any,
      FileController: { create: () => new FakeFtp() } as any,
    });

    await client.pause();
    await client.resume();
    await client.stop();
    await client.startPrint({
      remoteName: "bracket-left-r1.gcode.3mf",
      plate: 1,
      useAms: true,
      amsMapping: [0],
      bedType: "auto",
      timelapse: false,
      flowCali: true,
      bedLeveling: true,
      vibrationCali: true,
      layerInspect: false,
    });

    expect(printer.sent.map((p) => (p.print as { command: string } | undefined)?.command)).toEqual(
      ["pause", "resume", "stop", "project_file"],
    );
    const start = printer.sent.at(-1) as {
      print: { url: string; param: string; ams_mapping: number[] };
    };
    expect(start.print.url).toBe("ftp:///bracket-left-r1.gcode.3mf");
    expect(start.print.param).toBe("Metadata/plate_1.gcode");
    expect(start.print.ams_mapping).toEqual([0]);
  });

  it("lists and uploads over a short-lived FTPS controller", async () => {
    const ftp = new FakeFtp();
    const client = new BambuLanClient(cfg, {
      PrinterController: { create: () => new FakePrinter() } as any,
      FileController: { create: () => ftp } as any,
    });
    await expect(client.listFiles()).resolves.toEqual(["bracket-left-r1.gcode.3mf"]);
    await client.upload("/tmp/bracket-left-r1.gcode.3mf", "bracket-left-r1.gcode.3mf");
    expect(ftp.uploaded[0]).toEqual({
      local: "/tmp/bracket-left-r1.gcode.3mf",
      remote: "/bracket-left-r1.gcode.3mf",
    });
  });
});

describe("config", () => {
  it("maps P2S → P1S dialect and requires live secrets", async () => {
    const { loadConfig } = await import("../config.js");
    expect(loadConfig({ BAMBU_MOCK: "1", BAMBU_MODEL: "P2S" }).model).toBe("P1S");
    expect(() => loadConfig({ BAMBU_MODEL: "P1S" })).toThrow(/BAMBU_IP/);
    const live = loadConfig({
      BAMBU_IP: "10.0.0.8",
      BAMBU_ACCESS_CODE: "abcdefgh",
      BAMBU_SERIAL: "01P00A1",
      BAMBU_MODEL: "P1S",
    });
    expect(live).toMatchObject({ ip: "10.0.0.8", mock: false, model: "P1S", safeMode: true });
  });
});

// silence unused import if tree-shaken
void vi;
