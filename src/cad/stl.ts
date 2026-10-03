export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Triangle {
  a: Vec3;
  b: Vec3;
  c: Vec3;
}

export interface Bounds {
  min: Vec3;
  max: Vec3;
}

export function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function scale(a: Vec3, s: number): Vec3 {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}

export function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

export function len(a: Vec3): number {
  return Math.hypot(a.x, a.y, a.z);
}

export function tri(a: Vec3, b: Vec3, c: Vec3): Triangle {
  return { a, b, c };
}

export function faceNormal(t: Triangle): Vec3 {
  const n = cross(sub(t.b, t.a), sub(t.c, t.a));
  const length = len(n);
  if (length < 1e-12) return { x: 0, y: 0, z: 0 };
  return scale(n, 1 / length);
}

/** Positive when vertices are wound so the solid's volume is outward. */
export function signedVolume(triangles: Triangle[]): number {
  let volume = 0;
  for (const t of triangles) volume += dot(t.a, cross(t.b, t.c));
  return volume / 6;
}

export function boundsOf(triangles: Triangle[]): Bounds {
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const t of triangles) {
    for (const p of [t.a, t.b, t.c]) {
      min.x = Math.min(min.x, p.x);
      min.y = Math.min(min.y, p.y);
      min.z = Math.min(min.z, p.z);
      max.x = Math.max(max.x, p.x);
      max.y = Math.max(max.y, p.y);
      max.z = Math.max(max.z, p.z);
    }
  }
  return { min, max };
}

export function sizeOf(triangles: Triangle[]): Vec3 {
  const box = boundsOf(triangles);
  return { x: box.max.x - box.min.x, y: box.max.y - box.min.y, z: box.max.z - box.min.z };
}

const QUANT = 1e4;

function q(n: number): number {
  return Math.round(n * QUANT) / QUANT;
}

function vkey(p: Vec3): string {
  return `${q(p.x)},${q(p.y)},${q(p.z)}`;
}

function edgeKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export function isWatertight(triangles: Triangle[]): boolean {
  if (triangles.length === 0) return false;
  const counts = new Map<string, number>();
  for (const t of triangles) {
    const keys = [vkey(t.a), vkey(t.b), vkey(t.c)];
    for (let i = 0; i < 3; i++) {
      const key = edgeKey(keys[i], keys[(i + 1) % 3]);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  for (const count of counts.values()) {
    if (count !== 2) return false;
  }
  return true;
}

class UnionFind {
  private parent: number[];

  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
  }

  find(i: number): number {
    let root = i;
    while (this.parent[root] !== root) root = this.parent[root];
    while (this.parent[i] !== root) {
      const next = this.parent[i];
      this.parent[i] = root;
      i = next;
    }
    return root;
  }

  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[rb] = ra;
  }
}

/** Triangles that share an edge stay in one shell. Separate solids stay separate. */
export function shells(triangles: Triangle[]): Triangle[][] {
  const uf = new UnionFind(triangles.length);
  const owner = new Map<string, number>();
  triangles.forEach((t, index) => {
    const keys = [vkey(t.a), vkey(t.b), vkey(t.c)];
    for (let i = 0; i < 3; i++) {
      const key = edgeKey(keys[i], keys[(i + 1) % 3]);
      const prev = owner.get(key);
      if (prev === undefined) owner.set(key, index);
      else uf.union(prev, index);
    }
  });
  const groups = new Map<number, Triangle[]>();
  triangles.forEach((t, index) => {
    const root = uf.find(index);
    const list = groups.get(root);
    if (list) list.push(t);
    else groups.set(root, [t]);
  });
  return [...groups.values()];
}

export function writeBinaryStl(triangles: Triangle[], label: string): Buffer {
  const header = Buffer.alloc(80);
  header.write(label.slice(0, 79));
  const buf = Buffer.alloc(84 + triangles.length * 50);
  header.copy(buf, 0);
  buf.writeUInt32LE(triangles.length, 80);
  let offset = 84;
  for (const t of triangles) {
    const n = faceNormal(t);
    for (const p of [n, t.a, t.b, t.c]) {
      buf.writeFloatLE(p.x, offset);
      buf.writeFloatLE(p.y, offset + 4);
      buf.writeFloatLE(p.z, offset + 8);
      offset += 12;
    }
    buf.writeUInt16LE(0, offset);
    offset += 2;
  }
  return buf;
}

export function readBinaryStl(buf: Buffer): Triangle[] {
  if (buf.length < 84) throw new Error("STL is too small to be a binary mesh");
  const count = buf.readUInt32LE(80);
  const expected = 84 + count * 50;
  if (buf.length !== expected) {
    throw new Error(`STL length ${buf.length} does not match binary triangle count ${count}`);
  }
  const triangles: Triangle[] = [];
  let offset = 84;
  for (let i = 0; i < count; i++) {
    offset += 12;
    const read = (): Vec3 => {
      const p = {
        x: buf.readFloatLE(offset),
        y: buf.readFloatLE(offset + 4),
        z: buf.readFloatLE(offset + 8),
      };
      offset += 12;
      return p;
    };
    const a = read();
    const b = read();
    const c = read();
    offset += 2;
    triangles.push({ a, b, c });
  }
  return triangles;
}
