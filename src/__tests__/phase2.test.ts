import { describe, expect, it } from "vitest";
import {
  cameraControlPayload,
  chamberLightPayload,
  getVersionPayload,
  modulesFrom,
  soundEnablePayload,
  statusFrom,
} from "../client.js";
import { loadConfig } from "../config.js";
import { guardWrite } from "../gates.js";
import { MockPrinter } from "../mock.js";
import { capabilitiesFor, normalizeModel } from "../models.js";
import { createTools } from "../tools.js";

const ALIASES: Array<[string, string, "P1S" | "H2D"]> = [
  ["P1S", "P1S", "P1S"],
  ["p1s", "P1S", "P1S"],
  ["P2S", "P2S", "P1S"],
  ["P1P", "P1P", "P1S"],
  ["X1C", "X1C", "P1S"],
  ["X1", "X1", "P1S"],
  ["x1e", "X1E", "P1S"],
  ["A1", "A1", "P1S"],
  ["A1MINI", "A1MINI", "P1S"],
  ["A1_MINI", "A1MINI", "P1S"],
  ["a1-mini", "A1MINI", "P1S"],
  ["A1-MINI", "A1MINI", "P1S"],
  ["A1 MINI", "A1MINI", "P1S"],
  ["H2D", "H2D", "H2D"],
  ["H2S", "H2S", "H2D"],
  ["h2s", "H2S", "H2D"],
];

function tool(
  name: string,
  port = new MockPrinter(),
  safeMode = true,
  capabilities = capabilitiesFor("P1S"),
) {
  const found = createTools(port, { safeMode, capabilities }).find((entry) => entry.name === name);
  if (!found) throw new Error(`missing tool ${name}`);
  return found;
}

describe("normalizeModel", () => {
  it("maps every accepted alias onto a bambu-js dialect", () => {
    for (const [raw, hardware, dialect] of ALIASES) {
      expect(normalizeModel(raw)).toEqual({ hardwareModel: hardware, dialect });
    }
  });

  it("keeps hardwareModel apart from the dialect on loadConfig", () => {
    const cfg = loadConfig({ BAMBU_MOCK: "1", BAMBU_MODEL: "P2S" });
    expect(cfg.hardwareModel).toBe("P2S");
    expect(cfg.model).toBe("P1S");
    expect(cfg.capabilities.chamberHeater).toBe(false);
    expect(cfg.capabilities.chamberLight).toBe(true);
    expect(loadConfig({ BAMBU_MOCK: "1", BAMBU_MODEL: "H2S" }).model).toBe("H2D");
    expect(loadConfig({ BAMBU_MOCK: "1", BAMBU_MODEL: "X1C" }).hardwareModel).toBe("X1C");
  });

  it("rejects unknown model strings and lists accepted names", () => {
    for (const raw of ["nope", "", "   ", "X1CC", "P2", "A1MINIATURE"]) {
      expect(() => normalizeModel(raw)).toThrow(/A1-MINI/);
      expect(() => normalizeModel(raw)).toThrow(/X1C/);
      expect(() => normalizeModel(raw)).toThrow(new RegExp(`got ${raw}`));
    }
    expect(() => loadConfig({ BAMBU_MOCK: "1", BAMBU_MODEL: "ender3" })).toThrow(/BAMBU_MODEL must be one of/);
  });
});

describe("capabilities", () => {
  it("describes P2S as enclosed with a camera and no chamber heater", () => {
    expect(capabilitiesFor("P2S")).toMatchObject({
      chamberLight: true,
      workLight: false,
      chamberTempSensor: true,
      chamberHeater: false,
      ipcamRecord: true,
      timelapse: true,
    });
    expect(capabilitiesFor("X1C").workLight).toBe(true);
    expect(capabilitiesFor("X1E").chamberHeater).toBe(true);
    expect(capabilitiesFor("A1")).toMatchObject({
      chamberLight: false,
      chamberTempSensor: false,
      chamberHeater: false,
      ipcamRecord: true,
    });
    expect(capabilitiesFor("P1P").ipcamRecord).toBe(false);
    expect(capabilitiesFor("H2D").chamberHeater).toBe(true);
  });

  it("returns supported:false for missing hardware and does not throw or send", async () => {
    const port = new MockPrinter();
    const a1 = capabilitiesFor("A1");
    await expect(tool("set_light", port, true, a1).handler({ on: true })).resolves.toEqual({
      supported: false,
      on: true,
      led_node: "chamber_light",
    });
    await expect(tool("temps", port, true, a1).handler({})).resolves.toMatchObject({
      nozzleC: 25,
      chamberC: null,
    });

    const p1p = capabilitiesFor("P1P");
    await expect(
      tool("set_camera", port, true, p1p).handler({ record: true, timelapse: false }),
    ).resolves.toEqual({
      supported: false,
      record: { supported: false },
      timelapse: { supported: false },
    });

    const p2s = capabilitiesFor("P2S");
    await expect(tool("set_light", port, true, p2s).handler({ on: true, node: "work_light" })).resolves.toEqual({
      supported: false,
      on: true,
      led_node: "work_light",
    });

    const noFiles = { ...capabilitiesFor("P1S"), ftps: false, ams: false };
    await expect(tool("list_files", port, true, noFiles).handler({})).resolves.toEqual({
      supported: false,
      files: [],
    });
    await expect(tool("ams", port, true, noFiles).handler({})).resolves.toEqual({
      supported: false,
      units: [],
      activeSlot: null,
    });

    expect(port.commands).toEqual([]);
    expect(port.started).toHaveLength(0);
  });
});

describe("get_version and richer status", () => {
  it("returns module hw/sw from MockPrinter and drops serial numbers", async () => {
    const port = new MockPrinter();
    await expect(tool("get_version", port).handler({})).resolves.toEqual({
      modules: [
        { name: "ota", hwVer: null, swVer: "01.01.01.00" },
        { name: "mc", hwVer: "MC07", swVer: "00.00.10.48" },
      ],
    });
    expect(port.commands).toEqual(["get_version"]);
    expect(JSON.stringify(modulesFrom({ module: [{ name: "mc", hw_ver: "MC07", sw_ver: "1", sn: "SECRET" }] }))).not.toContain(
      "SECRET",
    );
    expect(getVersionPayload("3")).toEqual({
      info: { sequence_id: "3", command: "get_version" },
    });
  });

  it("adds wifi, errors, multi-node lights, camera flags, and AMS humidity when present", async () => {
    const port = new MockPrinter();
    port.report = {
      gcode_state: "IDLE",
      mc_percent: 12,
      wifi_signal: "-45dBm",
      print_error: 0,
      mc_print_error_code: "0",
      lights_report: [
        { node: "chamber_light", mode: "on" },
        { node: "work_light", mode: "off" },
      ],
      ipcam: { ipcam_record: "disable", timelapse: "enable", rtsp_url: "rtsp://secret" },
      ams: { ams: [{ id: "0", humidity: "4", temp: "22.7", tray: [] }] },
    };

    const status = await tool("status", port).handler({});
    expect(status).toMatchObject({
      state: "IDLE",
      percent: 12,
      safeMode: true,
      chamberLight: "on",
      wifiSignal: "-45dBm",
      printError: 0,
      errorCode: "0",
      lights: [
        { node: "chamber_light", mode: "on" },
        { node: "work_light", mode: "off" },
      ],
      ipcam: { record: "disable", timelapse: "enable" },
      amsHumidity: [{ id: 0, humidity: "4" }],
    });
    expect(JSON.stringify(status)).not.toContain("rtsp");

    expect(statusFrom({ gcode_state: "IDLE" })).toMatchObject({
      chamberLight: null,
      lights: null,
      wifiSignal: null,
      wifi: null,
      printError: null,
      errorCode: null,
      amsHumidity: null,
      ipcam: null,
    });
  });
});

describe("camera and sound stay allowed in safe mode", () => {
  it("toggles record and timelapse while print stays blocked", async () => {
    const port = new MockPrinter();
    await expect(tool("set_camera", port).handler({ record: true, timelapse: false })).resolves.toEqual({
      supported: true,
      record: "enable",
      timelapse: "disable",
    });
    expect(port.commands).toEqual(["ipcam_record_set:enable", "ipcam_timelapse:disable"]);
    expect(cameraControlPayload("ipcam_record_set", true, "4")).toEqual({
      camera: { sequence_id: "4", command: "ipcam_record_set", control: "enable" },
    });
    expect(cameraControlPayload("ipcam_timelapse", false, "5")).toEqual({
      camera: { sequence_id: "5", command: "ipcam_timelapse", control: "disable" },
    });

    expect(createTools(port, { safeMode: true }).some((entry) => entry.name === "print")).toBe(false);
    expect(() => guardWrite("print", true, true)).toThrow(/BAMBU_SAFE_MODE/);
    expect(port.started).toHaveLength(0);
    expect(port.state).toBe("IDLE");
  });

  it("sets sound_enable only", async () => {
    const port = new MockPrinter();
    await expect(tool("set_sound", port).handler({ on: false })).resolves.toEqual({
      on: false,
      sound_enable: false,
    });
    expect(port.commands).toEqual(["sound_enable:false"]);
    const payload = soundEnablePayload(true, "9");
    expect(payload).toEqual({
      print: { sequence_id: "9", command: "print_option", sound_enable: true },
    });
    expect(Object.keys(payload.print)).toEqual(["sequence_id", "command", "sound_enable"]);
    expect(JSON.stringify(payload)).not.toMatch(/print_halt|air_print|filament_tangle|nozzle_blob|auto_recovery|xcam/);
  });

  it("sends work_light only when that node exists", async () => {
    const port = new MockPrinter();
    await expect(
      tool("set_light", port, true, capabilitiesFor("X1C")).handler({ on: true, node: "work_light" }),
    ).resolves.toEqual({ supported: true, on: true, led_node: "work_light" });
    expect(port.commands).toEqual(["ledctrl:work_light:on"]);
    expect(chamberLightPayload(true, "2", "work_light").system.led_node).toBe("work_light");
    expect(port.started).toHaveLength(0);
  });
});
