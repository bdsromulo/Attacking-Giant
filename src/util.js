import * as THREE from 'three';

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
export const randInt = (a, b) => Math.floor(rand(a, b + 1));
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

export function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

// Ray vs AABB (slab). Retorna t de entrada ou -1. Preenche normal.
export function rayAABB(o, d, min, max, maxT, outN) {
  let tmin = 0, tmax = maxT, axis = -1, sign = 0;
  for (let i = 0; i < 3; i++) {
    const oi = i === 0 ? o.x : i === 1 ? o.y : o.z;
    const di = i === 0 ? d.x : i === 1 ? d.y : d.z;
    const mn = i === 0 ? min.x : i === 1 ? min.y : min.z;
    const mx = i === 0 ? max.x : i === 1 ? max.y : max.z;
    if (Math.abs(di) < 1e-9) {
      if (oi < mn || oi > mx) return -1;
    } else {
      const inv = 1 / di;
      let t1 = (mn - oi) * inv, t2 = (mx - oi) * inv, s = -1;
      if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; s = 1; }
      if (t1 > tmin) { tmin = t1; axis = i; sign = s; }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return -1;
    }
  }
  if (axis === -1) return -1; // origem dentro da caixa
  if (outN) {
    outN.set(0, 0, 0);
    if (axis === 0) outN.x = sign; else if (axis === 1) outN.y = sign; else outN.z = sign;
  }
  return tmin;
}

// Geometria de caixa colorida, não indexada, pronta para merge.
const _c = new THREE.Color();
export function coloredBox(sx, sy, sz, color, x = 0, y = 0, z = 0, rotY = 0, jitter = 0.035) {
  const g = new THREE.BoxGeometry(sx, sy, sz).toNonIndexed();
  g.deleteAttribute('uv');
  if (rotY) g.rotateY(rotY);
  g.translate(x, y, z);
  paint(g, color, jitter);
  return g;
}

export function paint(g, color, jitter = 0) {
  _c.set(color);
  if (jitter) _c.offsetHSL(0, 0, (Math.random() * 2 - 1) * jitter);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = _c.r; arr[i * 3 + 1] = _c.g; arr[i * 3 + 2] = _c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

// Prisma triangular (telhado) com cumeeira no eixo X.
export function roofPrism(w, h, d, color, x, y, z, alongZ = false) {
  const hw = w / 2, hd = d / 2;
  // vértices: base retangular em y=0, cumeeira em y=h no centro de z
  const A = [-hw, 0, -hd], B = [hw, 0, -hd], C = [hw, 0, hd], D = [-hw, 0, hd];
  const E = [-hw, h, 0], F = [hw, h, 0];
  const tris = [
    A, F, B, A, E, F,       // inclinação -z
    D, C, F, D, F, E,       // inclinação +z
    A, D, E,                // empena -x
    B, F, C,                // empena +x
    A, B, C, A, C, D,       // fundo
  ];
  const pos = new Float32Array(tris.length * 3);
  tris.forEach((v, i) => { pos[i * 3] = v[0]; pos[i * 3 + 1] = v[1]; pos[i * 3 + 2] = v[2]; });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.computeVertexNormals();
  if (alongZ) g.rotateY(Math.PI / 2);
  g.translate(x, y, z);
  paint(g, color, 0.03);
  return g;
}
