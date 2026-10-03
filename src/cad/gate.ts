import { readFileSync } from "node:fs";
import {
  FAILED_SKULL_HEIGHT_MM,
  countSolids,
  isPrimitiveCsg,
  type SolidCounts,
} from "./primitive.js";
import { REQUIRED_VIEWS, loadReferenceViews, type LoadedView, type ViewId } from "./refs.js";
import { isWatertight, readBinaryStl, sizeOf } from "./stl.js";

/** P2S plate from harness/references/printer.md. A few millimeters stay clear of the edge. */
export const P2S_BED_MM = 256;
export const P2S_EDGE_MARGIN_MM = 4;
export const P2S_FIT_MM = P2S_BED_MM - P2S_EDGE_MARGIN_MM;

export const COSINE_NOTE =
  "DINOv2 and CLIP define cosine similarity of image embeddings. Neither page publishes a T-800 cutoff. Cosine is a log, not a pass. This path does not download those weights and does not invent a cutoff.";

export const LIKENESS_NOTE =
  "A likeness pass is a human, or a VLM asked if the render is the same object. This VM cannot claim that pass. Watertight, millimeters, and P2S bed scale stay required and still cannot pass the mesh alone.";

export const COPYRIGHT_NOTE =
  "The T-800 is a copyrighted film character. Personal print only. This path does not publish a mesh.";

export interface CadGateReport {
  accepted: boolean;
  units: string;
  watertight: boolean;
  /** Bbox height when units are millimeters. Null when the mesh was not declared in mm. */
  heightMm: number | null;
  /** The failed script's height. Recorded so a match is visible and still not a pass. */
  failedScriptHeightMm: typeof FAILED_SKULL_HEIGHT_MM;
  fitsP2sBed: boolean;
  bedMm: typeof P2S_BED_MM;
  fitLimitMm: typeof P2S_FIT_MM;
  sizeMm: { x: number; y: number; z: number };
  solids: SolidCounts;
  primitiveCsg: boolean;
  necessary: {
    manifold: boolean;
    millimeters: boolean;
    p2sBed: boolean;
    note: string;
  };
  likeness: {
    views: LoadedView[];
    missing: ViewId[];
    viewCount: number;
    requiredViewCount: number;
    oneViewFails: boolean;
    sideView: null;
    sidePhotoInvented: false;
    humanOrVlm: "not-reviewed";
    dinov2Cosine: null;
    clipCosine: null;
    cutoff: null;
    note: string;
  };
  copyright: string;
  reasons: string[];
}

export function validateMeshFile(
  meshPath: string,
  options: { units: string; refsDir?: string },
): CadGateReport {
  const triangles = readBinaryStl(readFileSync(meshPath));
  const size = sizeOf(triangles);
  const units = options.units;
  const millimeters = units === "mm";
  const watertight = isWatertight(triangles);
  const fitsP2sBed =
    millimeters &&
    size.x > 0 &&
    size.y > 0 &&
    size.z > 0 &&
    size.x <= P2S_FIT_MM &&
    size.y <= P2S_FIT_MM &&
    size.z <= P2S_FIT_MM;
  const solids = countSolids(triangles);
  const primitiveCsg = isPrimitiveCsg(solids);
  const views = loadReferenceViews(options.refsDir);
  const oneViewFails = views.present.length < REQUIRED_VIEWS.length;
  const reasons: string[] = [];
  if (!watertight) reasons.push("manifold: mesh is not watertight");
  if (!millimeters) reasons.push("millimeters: units must be millimeters");
  if (!fitsP2sBed) reasons.push("p2s-bed: mesh is not a millimeter solid that fits the P2S bed");
  if (primitiveCsg) {
    reasons.push("primitive-csg: spheres, boxes, and cylinders are not a likeness");
  }
  if (oneViewFails) reasons.push("likeness: one view is a fail");
  reasons.push("likeness: no human or VLM same-object decision; cosine similarity is not a pass");
  if (watertight && millimeters && fitsP2sBed) {
    reasons.push("watertight and size are not a pass");
  }
  return {
    accepted: reasons.length === 0,
    units,
    watertight,
    heightMm: millimeters ? size.z : null,
    failedScriptHeightMm: FAILED_SKULL_HEIGHT_MM,
    fitsP2sBed,
    bedMm: P2S_BED_MM,
    fitLimitMm: P2S_FIT_MM,
    sizeMm: { x: size.x, y: size.y, z: size.z },
    solids,
    primitiveCsg,
    necessary: {
      manifold: watertight,
      millimeters,
      p2sBed: fitsP2sBed,
      note: "Manifold, millimeters, and P2S bed scale are required and cannot pass the mesh alone.",
    },
    likeness: {
      views: views.present,
      missing: views.missing,
      viewCount: views.present.length,
      requiredViewCount: REQUIRED_VIEWS.length,
      oneViewFails,
      sideView: null,
      sidePhotoInvented: false,
      humanOrVlm: "not-reviewed",
      dinov2Cosine: null,
      clipCosine: null,
      cutoff: null,
      note: `${COSINE_NOTE} ${LIKENESS_NOTE} ${views.note}`,
    },
    copyright: COPYRIGHT_NOTE,
    reasons,
  };
}
