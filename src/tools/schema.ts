import { z } from "zod";

export const noArgs = z.object({});

export const confirmField = z.boolean().describe("Must be true. Ask the operator before setting this.");

export const blockedNote =
  "Refused until BAMBU_SAFE_MODE=0. Motion tools still need confirm: true after an explicit human ask.";
