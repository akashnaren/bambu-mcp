import {
  add,
  boundsOf,
  faceNormal,
  len,
  scale,
  shells,
  signedVolume,
  sizeOf,
  sub,
  tri,
  type Triangle,
  type Vec3,
} from "./stl.js";

export type SolidKind = "sphere" | "box" | "cylinder" | "other";

export interface SolidCounts {
  sphere: number;
  box: number;
  cylinder: number;
  other: number;
}

/** Target height of the failed primitive skull. Matching it is not a pass. */
export const FAILED_SKULL_HEIGHT_MM = 76.2;

function outward(triangles: Triangle[]): Triangle[] {
  if (signedVolume(triangles) >= 0) return triangles;
  return triangles.map((t) => tri(t.a, t.c, t.b));
}

export function boxSolid(min: Vec3, max: Vec3): Triangle[] {
  const p = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
  const { x: x0, y: y0, z: z0 } = min;
  const { x: x1, y: y1, z: z1 } = max;
  return outward([
    tri(p(x0, y0, z1), p(x1, y0, z1), p(x1, y1, z1)),
    tri(p(x0, y0, z1), p(x1, y1, z1), p(x0, y1, z1)),
    tri(p(x0, y1, z0), p(x1, y1, z0), p(x1, y0, z0)),
    tri(p(x0, y1, z0), p(x1, y0, z0), p(x0, y0, z0)),
    tri(p(x0, y1, z0), p(x0, y1, z1), p(x1, y1, z1)),
    tri(p(x0, y1, z0), p(x1, y1, z1), p(x1, y1, z0)),
    tri(p(x1, y0, z0), p(x1, y0, z1), p(x0, y0, z1)),
    tri(p(x1, y0, z0), p(x0, y0, z1), p(x0, y0, z0)),
    tri(p(x1, y0, z0), p(x1, y1, z0), p(x1, y1, z1)),
    tri(p(x1, y0, z0), p(x1, y1, z1), p(x1, y0, z1)),
    tri(p(x0, y1, z0), p(x0, y0, z0), p(x0, y0, z1)),
    tri(p(x0, y1, z0), p(x0, y0, z1), p(x0, y1, z1)),
  ]);
}

export function sphereSolid(center: Vec3, radius: number): Triangle[] {
  const phi = (1 + Math.sqrt(5)) / 2;
  const raw = [
    [-1, phi, 0],
    [1, phi, 0],
    [-1, -phi, 0],
    [1, -phi, 0],
    [0, -1, phi],
    [0, 1, phi],
    [0, -1, -phi],
    [0, 1, -phi],
    [phi, 0, -1],
    [phi, 0, 1],
    [-phi, 0, -1],
    [-phi, 0, 1],
  ].map(([x, y, z]) => {
    const length = Math.hypot(x, y, z);
    return {
      x: center.x + (x / length) * radius,
      y: center.y + (y / length) * radius,
      z: center.z + (z / length) * radius,
    };
  });
  const faces = [
    [0, 11, 5],
    [0, 5, 1],
    [0, 1, 7],
    [0, 7, 10],
    [0, 10, 11],
    [1, 5, 9],
    [5, 11, 4],
    [11, 10, 2],
    [10, 7, 6],
    [7, 1, 8],
    [3, 9, 4],
    [3, 4, 2],
    [3, 2, 6],
    [3, 6, 8],
    [3, 8, 9],
    [4, 9, 5],
    [2, 4, 11],
    [6, 2, 10],
    [8, 6, 7],
    [9, 8, 1],
  ];
  return outward(faces.map(([i, j, k]) => tri(raw[i], raw[j], raw[k])));
}

export function cylinderSolid(radius: number, z0: number, z1: number, segments = 16): Triangle[] {
  const triangles: Triangle[] = [];
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2;
    const a1 = ((i + 1) / segments) * Math.PI * 2;
    const p0 = { x: radius * Math.cos(a0), y: radius * Math.sin(a0) };
    const p1 = { x: radius * Math.cos(a1), y: radius * Math.sin(a1) };
    const b0: Vec3 = { x: p0.x, y: p0.y, z: z0 };
    const b1: Vec3 = { x: p1.x, y: p1.y, z: z0 };
    const t0: Vec3 = { x: p0.x, y: p0.y, z: z1 };
    const t1: Vec3 = { x: p1.x, y: p1.y, z: z1 };
    triangles.push(tri(b0, b1, t1), tri(b0, t1, t0));
    triangles.push(tri(b1, b0, { x: 0, y: 0, z: z0 }));
    triangles.push(tri(t0, t1, { x: 0, y: 0, z: z1 }));
  }
  return outward(triangles);
}

/** Four-face solid that is not a sphere, box, or cylinder. */
export function otherSolid(height: number): Triangle[] {
  return outward([
    tri({ x: 0, y: 0, z: 0 }, { x: 8, y: 36, z: 2 }, { x: 50, y: 0, z: 0 }),
    tri({ x: 0, y: 0, z: 0 }, { x: 50, y: 0, z: 0 }, { x: 14, y: 9, z: height }),
    tri({ x: 50, y: 0, z: 0 }, { x: 8, y: 36, z: 2 }, { x: 14, y: 9, z: height }),
    tri({ x: 8, y: 36, z: 2 }, { x: 0, y: 0, z: 0 }, { x: 14, y: 9, z: height }),
  ]);
}

function translate(triangles: Triangle[], delta: Vec3): Triangle[] {
  const move = (p: Vec3): Vec3 => add(p, delta);
  return triangles.map((t) => tri(move(t.a), move(t.b), move(t.c)));
}

function uniform(triangles: Triangle[], factor: number): Triangle[] {
  const mul = (p: Vec3): Vec3 => scale(p, factor);
  return triangles.map((t) => tri(mul(t.a), mul(t.b), mul(t.c)));
}

/**
 * In-memory stand-in for the missing `prints/make_t800_skull.py`.
 * Spheres, a box, and a cylinder, scaled to 76.2 mm. Not a likeness and not a file in git.
 */
export function primitiveCsgSkull(): Triangle[] {
  let mesh = [
    cylinderSolid(8, 0, 24),
    boxSolid({ x: -18, y: 10, z: 6 }, { x: 18, y: 28, z: 20 }),
    sphereSolid({ x: 0, y: 0, z: 48 }, 28),
    sphereSolid({ x: -9, y: 16, z: 50 }, 4),
    sphereSolid({ x: 9, y: 16, z: 50 }, 4),
  ].flat();
  const height = sizeOf(mesh).z;
  mesh = uniform(mesh, FAILED_SKULL_HEIGHT_MM / height);
  const fitted = boundsOf(mesh);
  return translate(mesh, { x: -fitted.min.x, y: -fitted.min.y, z: -fitted.min.z });
}

function unique(triangles: Triangle[]): Vec3[] {
  const seen = new Set<string>();
  const points: Vec3[] = [];
  for (const t of triangles) {
    for (const p of [t.a, t.b, t.c]) {
      const key = `${p.x},${p.y},${p.z}`;
      if (seen.has(key)) continue;
      seen.add(key);
      points.push(p);
    }
  }
  return points;
}

function meanPoint(points: Vec3[]): Vec3 {
  const sum = points.reduce((acc, p) => add(acc, p), { x: 0, y: 0, z: 0 });
  return scale(sum, 1 / Math.max(points.length, 1));
}

function cv(values: number[]): number {
  if (values.length === 0) return Infinity;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  if (mean < 1e-9) return Infinity;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance) / mean;
}

function axisAligned(n: Vec3): boolean {
  const ax = Math.abs(n.x);
  const ay = Math.abs(n.y);
  const az = Math.abs(n.z);
  const dominant = Math.max(ax, ay, az);
  return dominant > 0.98 && ax + ay + az - dominant < 0.08;
}

function isBox(triangles: Triangle[]): boolean {
  if (triangles.length < 12) return false;
  const dirs = new Set<string>();
  for (const t of triangles) {
    const n = faceNormal(t);
    if (len(n) < 0.5 || !axisAligned(n)) return false;
    const axis = Math.abs(n.x) > 0.9 ? "x" : Math.abs(n.y) > 0.9 ? "y" : "z";
    const sign = (axis === "x" ? n.x : axis === "y" ? n.y : n.z) >= 0 ? "+" : "-";
    dirs.add(sign + axis);
  }
  return dirs.size === 6;
}

function isSphere(triangles: Triangle[]): boolean {
  if (triangles.length < 16) return false;
  const points = unique(triangles);
  const center = meanPoint(points);
  return cv(points.map((p) => len(sub(p, center)))) < 0.02;
}

function isCylinder(triangles: Triangle[]): boolean {
  const caps: Triangle[] = [];
  const sides: Triangle[] = [];
  for (const t of triangles) {
    const n = faceNormal(t);
    if (Math.abs(n.z) > 0.9) caps.push(t);
    else sides.push(t);
  }
  if (caps.length < 4 || sides.length < 8) return false;
  let up = false;
  let down = false;
  for (const t of caps) {
    const n = faceNormal(t);
    if (n.z > 0.9) up = true;
    if (n.z < -0.9) down = true;
  }
  if (!up || !down) return false;
  const points = unique(sides);
  const center = meanPoint(points);
  return cv(points.map((p) => Math.hypot(p.x - center.x, p.y - center.y))) < 0.05;
}

export function classifySolid(triangles: Triangle[]): SolidKind {
  if (isBox(triangles)) return "box";
  if (isSphere(triangles)) return "sphere";
  if (isCylinder(triangles)) return "cylinder";
  return "other";
}

export function countSolids(triangles: Triangle[]): SolidCounts {
  const counts: SolidCounts = { sphere: 0, box: 0, cylinder: 0, other: 0 };
  for (const shell of shells(triangles)) counts[classifySolid(shell)] += 1;
  return counts;
}

export function isPrimitiveCsg(counts: SolidCounts): boolean {
  const total = counts.sphere + counts.box + counts.cylinder + counts.other;
  return total > 0 && counts.other === 0 && counts.sphere + counts.box + counts.cylinder === total;
}
