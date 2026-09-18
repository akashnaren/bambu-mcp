import { describe, expect, it } from "vitest";
import { assertConfirmed, isGatedTool } from "../confirm.js";

describe("confirm gate", () => {
  it("gates print, pause, resume, stop", () => {
    expect(["print", "pause", "resume", "stop"].every(isGatedTool)).toBe(true);
    expect(isGatedTool("status")).toBe(false);
  });

  it("requires confirm: true", () => {
    expect(() => assertConfirmed("print", false)).toThrow(/confirm-gated/);
    expect(() => assertConfirmed("pause", undefined)).toThrow(/confirm-gated/);
    expect(() => assertConfirmed("stop", "yes")).toThrow(/confirm-gated/);
    expect(() => assertConfirmed("print", true)).not.toThrow();
  });

  it("does not gate read tools", () => {
    expect(() => assertConfirmed("status", undefined)).not.toThrow();
  });
});
