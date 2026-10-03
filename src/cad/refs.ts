import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export type ViewId = "three-quarter" | "front";

export interface ReferenceSpec {
  id: ViewId;
  file: string;
  author: string;
  license: string;
  source: string;
}

/**
 * The two opened stills. A clean side was not found; do not add one.
 * The CC0 full-body fan video is another front view, not a side, and is not bundled.
 */
export const REQUIRED_VIEWS: readonly ReferenceSpec[] = [
  {
    id: "three-quarter",
    file: "01-t800-endoskeleton-3q-oberhaus.jpg",
    author: "Daniel Oberhaus",
    license: "CC BY 2.0",
    source: "https://commons.wikimedia.org/wiki/File:Terminator.jpg",
  },
  {
    id: "front",
    file: "02-terminator-salvation-skull-front-ank-kumar.jpg",
    author: "Ank Kumar",
    license: "CC BY-SA 4.0",
    source:
      "https://commons.wikimedia.org/wiki/File:Terminator_Skull_Head_Bust_from_Terminator_Salvation,_Earls_Court,_London_(Ank_Kumar,_Infosys_Limited).jpg",
  },
];

export const SIDE_VIEW_NOTE =
  "A clean skull side was not found. No side photo is invented. Likeness needs both the three-quarter Oberhaus view and the front Salvation bust. One view is a fail.";

export interface LoadedView {
  id: ViewId;
  file: string;
  width: number;
  height: number;
  bytes: number;
  author: string;
  license: string;
  source: string;
}

export interface ViewSet {
  present: LoadedView[];
  missing: ViewId[];
  /** Always null. A side file on disk is ignored and does not count. */
  sideView: null;
  sidePhotoInvented: false;
  note: string;
}

export function defaultRefsDir(): string {
  return fileURLToPath(new URL("../../cad/refs/", import.meta.url));
}

/** Baseline or progressive JPEG size. Enough to prove the file is the photograph. */
export function jpegSize(buf: Buffer): { width: number; height: number } {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) throw new Error("not a JPEG");
  let offset = 2;
  while (offset + 9 < buf.length) {
    if (buf[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buf[offset + 1];
    const standalone =
      marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7);
    if (standalone) {
      offset += 2;
      continue;
    }
    const length = buf.readUInt16BE(offset + 2);
    if (length < 2 || offset + 2 + length > buf.length) break;
    const sof = marker === 0xc0 || marker === 0xc1 || marker === 0xc2;
    if (sof) {
      return {
        height: buf.readUInt16BE(offset + 5),
        width: buf.readUInt16BE(offset + 7),
      };
    }
    offset += 2 + length;
  }
  throw new Error("JPEG has no frame header");
}

export function loadReferenceViews(dir = defaultRefsDir()): ViewSet {
  const present: LoadedView[] = [];
  const missing: ViewId[] = [];
  for (const spec of REQUIRED_VIEWS) {
    let buf: Buffer;
    try {
      buf = readFileSync(join(dir, spec.file));
    } catch {
      missing.push(spec.id);
      continue;
    }
    const size = jpegSize(buf);
    present.push({
      id: spec.id,
      file: spec.file,
      width: size.width,
      height: size.height,
      bytes: buf.length,
      author: spec.author,
      license: spec.license,
      source: spec.source,
    });
  }
  return {
    present,
    missing,
    sideView: null,
    sidePhotoInvented: false,
    note: SIDE_VIEW_NOTE,
  };
}
