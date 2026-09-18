import { describe, expect, it } from "vitest";
import { loadConfig } from "../config.js";

describe("loadConfig", () => {
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
