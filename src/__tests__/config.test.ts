import { describe, expect, it } from "vitest";
import { loadConfig } from "../config.js";

describe("loadConfig", () => {
  it("defaults BAMBU_SAFE_MODE to on when unset", () => {
    expect(loadConfig({ BAMBU_MOCK: "1" }).safeMode).toBe(true);
    expect(loadConfig({ BAMBU_MOCK: "1", BAMBU_SAFE_MODE: "" }).safeMode).toBe(true);
    expect(loadConfig({ BAMBU_MOCK: "1", BAMBU_SAFE_MODE: "1" }).safeMode).toBe(true);
    expect(loadConfig({ BAMBU_MOCK: "1", BAMBU_SAFE_MODE: "true" }).safeMode).toBe(true);
  });

  it("unlocks writes only when BAMBU_SAFE_MODE is explicitly off", () => {
    expect(loadConfig({ BAMBU_MOCK: "1", BAMBU_SAFE_MODE: "0" }).safeMode).toBe(false);
    expect(loadConfig({ BAMBU_MOCK: "1", BAMBU_SAFE_MODE: "false" }).safeMode).toBe(false);
    expect(loadConfig({ BAMBU_MOCK: "1", BAMBU_SAFE_MODE: "off" }).safeMode).toBe(false);
    expect(loadConfig({ BAMBU_MOCK: "1", BAMBU_SAFE_MODE: " 0 " }).safeMode).toBe(false);
    expect(loadConfig({ BAMBU_MOCK: "1", BAMBU_SAFE_MODE: "maybe" }).safeMode).toBe(true);
  });

  it("defaults safe mode on for a live config", () => {
    const live = loadConfig({
      BAMBU_IP: "10.0.0.1",
      BAMBU_ACCESS_CODE: "12345678",
      BAMBU_SERIAL: "S",
      BAMBU_MODEL: "P1S",
    });
    expect(live.safeMode).toBe(true);
    expect(
      loadConfig({
        BAMBU_IP: "10.0.0.1",
        BAMBU_ACCESS_CODE: "12345678",
        BAMBU_SERIAL: "S",
        BAMBU_SAFE_MODE: "0",
      }).safeMode,
    ).toBe(false);
  });

  it("rejects an unknown dialect", () => {
    expect(() =>
      loadConfig({
        BAMBU_IP: "10.0.0.1",
        BAMBU_ACCESS_CODE: "12345678",
        BAMBU_SERIAL: "S",
        BAMBU_MODEL: "X1C",
      }),
    ).toThrow(/P1S, P2S, or H2D/);
  });
});
