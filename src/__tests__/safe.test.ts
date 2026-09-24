import { describe, expect, it } from "vitest";
import { assertSafeModeAllows, parseSafeMode, safeModeBlockedMessage } from "../safe.js";

describe("parseSafeMode", () => {
  it("defaults to on when unset or blank", () => {
    expect(parseSafeMode(undefined)).toBe(true);
    expect(parseSafeMode("")).toBe(true);
    expect(parseSafeMode("   ")).toBe(true);
  });

  it("treats 1 / true / on / yes as on", () => {
    expect(parseSafeMode("1")).toBe(true);
    expect(parseSafeMode("true")).toBe(true);
    expect(parseSafeMode("TRUE")).toBe(true);
    expect(parseSafeMode("on")).toBe(true);
    expect(parseSafeMode("yes")).toBe(true);
  });

  it("unlocks only on explicit off values", () => {
    expect(parseSafeMode("0")).toBe(false);
    expect(parseSafeMode("false")).toBe(false);
    expect(parseSafeMode("FALSE")).toBe(false);
    expect(parseSafeMode("off")).toBe(false);
    expect(parseSafeMode("no")).toBe(false);
  });

  it("fails closed on unrecognized values", () => {
    expect(parseSafeMode("maybe")).toBe(true);
    expect(parseSafeMode("00")).toBe(true);
    expect(parseSafeMode("2")).toBe(true);
  });
});

describe("assertSafeModeAllows", () => {
  it("blocks write tools while safe mode is on", () => {
    for (const tool of ["upload", "print", "pause", "resume", "stop", "slice_hook"]) {
      expect(() => assertSafeModeAllows(tool, true)).toThrow(/BAMBU_SAFE_MODE=0/);
      expect(safeModeBlockedMessage(tool)).toMatch(/confirm: true/);
      expect(safeModeBlockedMessage(tool)).toMatch(/explicit human ask/);
    }
  });

  it("allows reads while safe mode is on and writes when it is off", () => {
    expect(() => assertSafeModeAllows("status", true)).not.toThrow();
    expect(() => assertSafeModeAllows("capabilities", true)).not.toThrow();
    expect(() => assertSafeModeAllows("print", false)).not.toThrow();
    expect(() => assertSafeModeAllows("slice_hook", false)).not.toThrow();
  });
});
