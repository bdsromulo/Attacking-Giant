import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CFG } from './config.js';
import { coloredBox, roofPrism, rayAABB, mulberry32, angleDiff, clamp } from './util.js';

const WALL_COLORS = ['#e8dcc4', '#efe6d2', '#d9c9a8', '#e3d2b0', '#cfc3ad', '#f2ead8', '#d8cdb8', '#e6d6bd'];
const ROOF_COLORS = ['#9c4a32', '#8a3b2b', '#a85a3c', '#6e4a3a', '#5d6470', '#7a3428', '#b0623f', '#874433'];
const TIMBER = '#4a3324';
const STONE = ['#9a9488', '#8c867a', '#a39d90', '#857f74'];
const LEAF = ['#4f7a3a', '#3f6b30', '#5a8541', '#467335', '#35602b'];

const _n = new THREE.Vector3();
const _v = new THREE.Vector3();

export class World {
  constructor(scene) {
    this.scene = scene;
    this.colliders = [];
    this.grid = new Map();
    this.cellSize = 24;
    this.depots = [];
    this.chunks = new Map();
    this.plazas = [];
    this.rng = mulberry32(20261105);
    this.material = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.group = new THREE.Group();
    scene.add(this.group);
    this.build();
  }

  R(a, b) { return a + this.rng() * (b - a); }
  P(arr) { return arr[Math.floor(this.rng() * arr.length)]; }

  // ---------- construção ----------
  addGeo(g, x, z) {
    const key = `${Math.floor(x / 110)},${Math.floor(z / 110)}`;
    if (!this.chunks.has(key)) this.chunks.set(key, []);
    this.chunks.get(key).push(g);
  }

  addCollider(minx, miny, minz, maxx, maxy, maxz, tag = 'solid') {
    const c = { min: new THREE.Vector3(minx, miny, minz), max: new THREE.Vector3(maxx, maxy, maxz), tag };
    this.colliders.push(c);
    const cs = this.cellSize;
    for (let gx = Math.floor(minx / cs); gx <= Math.floor(maxx / cs); gx++)
      for (let gz = Math.floor(minz / cs); gz <= Math.floor(maxz / cs); gz++) {
        const k = gx * 100000 + gz;
        if (!this.grid.has(k)) this.grid.set(k, []);
        this.grid.get(k).push(c);
      }
    return c;
  }

  // caixa com base em y0
  block(cx, y0, cz, sx, sy, sz, color, collide = false, jitter = 0.035) {
    this.addGeo(coloredBox(sx, sy, sz, color, cx, y0 + sy / 2, cz, 0, jitter), cx, cz);
    if (collide) this.addCollider(cx - sx / 2, y0, cz - sz / 2, cx + sx / 2, y0 + sy, cz + sz / 2);
  }

  build() {
    this.buildGround();
    this.buildWall();
    this.buildCity();
    this.buildForest();
    this.buildScenery();
    for (const [, geos] of this.chunks) {
      const merged = mergeGeometries(geos, false);
      const mesh = new THREE.Mesh(merged, this.material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      geos.forEach((g) => g.dispose());
    }
    this.chunks.clear();
  }

  buildGround() {
    const grass = new THREE.Mesh(
      new THREE.CircleGeometry(1600, 64).rotateX(-Math.PI / 2),
      new THREE.MeshLambertMaterial({ color: '#7f9a55' })
    );
    grass.receiveShadow = true;
    this.group.add(grass);
    const city = new THREE.Mesh(
      new THREE.CircleGeometry(CFG.WALL_R + 2, 96).rotateX(-Math.PI / 2),
      new THREE.MeshLambertMaterial({ color: '#a89d86' })
    );
    city.position.y = 0.02;
    city.receiveShadow = true;
    this.group.add(city);
    // trilha de terra saindo da brecha
    const path = new THREE.Mesh(
      new THREE.PlaneGeometry(320, 26).rotateX(-Math.PI / 2),
      new THREE.MeshLambertMaterial({ color: '#9b8a66' })
    );
    path.position.set(CFG.WALL_R + 150, 0.03, 0);
    path.receiveShadow = true;
    this.group.add(path);
  }

  inBreach(angle) {
    return Math.abs(angleDiff(angle, CFG.BREACH_ANGLE)) < CFG.BREACH_HALF;
  }

  buildWall() {
    const { WALL_R: R, WALL_H: H, WALL_T: T } = CFG;
    const N = 120;
    const seg = ((Math.PI * 2 * R) / N) * 1.06;
    for (let i = 0; i < N; i++) {
      const a = ((i + 0.5) / N) * Math.PI * 2;
      if (Math.abs(angleDiff(a, CFG.BREACH_ANGLE)) < CFG.BREACH_HALF + 0.012) continue;
      const x = Math.cos(a) * R, z = Math.sin(a) * R, rot = -a;
      const col = STONE[i % STONE.length];
      this.addGeo(coloredBox(T, H, seg, col, x, H / 2, z, rot, 0.02), x, z);
      // faixas e base
      this.addGeo(coloredBox(T + 1.2, 4, seg, '#7a756b', x, 2, z, rot, 0.02), x, z);
      this.addGeo(coloredBox(T + 0.6, 1.2, seg, '#77716a', x, H * 0.55, z, rot, 0.02), x, z);
      this.addGeo(coloredBox(T + 0.8, 1.4, seg, '#837d72', x, H - 0.7, z, rot, 0.02), x, z);
      // ameias (lado externo e interno)
      for (const off of [T / 2 - 0.4, -T / 2 + 0.4]) {
        const ox = x + Math.cos(a) * off, oz = z + Math.sin(a) * off;
        this.addGeo(coloredBox(0.8, 1.8, seg * 0.45, '#8f897d', ox, H + 0.9, oz, rot, 0.03), ox, oz);
      }
    }
    // tampas nas bordas da brecha
    for (const s of [-1, 1]) {
      const a = CFG.BREACH_ANGLE + s * (CFG.BREACH_HALF + 0.012);
      const x = Math.cos(a) * R, z = Math.sin(a) * R;
      this.addCollider(x - T / 2 - 1, 0, z - 2.5, x + T / 2 + 1, H, z + 2.5, 'wall');
      // borda quebrada
      for (let k = 0; k < 7; k++) {
        const y = this.R(0, H);
        this.addGeo(coloredBox(this.R(3, 7), this.R(3, 8), this.R(2, 5), this.P(STONE), x + this.R(-3, 3), y, z - s * this.R(0, 2), this.R(0, 1)), x, z);
      }
    }
    // escombros da brecha
    for (let k = 0; k < 70; k++) {
      const a = CFG.BREACH_ANGLE + this.R(-CFG.BREACH_HALF * 1.6, CFG.BREACH_HALF * 1.6);
      const r = R + this.R(-28, 30);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const sx = this.R(1.5, 5.5), sy = this.R(1, 4.5), sz = this.R(1.5, 5.5);
      const big = this.rng() < 0.35;
      this.block(x, 0, z, big ? sx * 1.6 : sx, big ? sy * 1.4 : sy, big ? sz * 1.6 : sz, this.P(STONE), true, 0.05);
    }
    // portão (decorativo, fechado) do lado oposto
    const ga = Math.PI;
    const gx = Math.cos(ga) * (R - T / 2 - 0.3);
    this.block(gx, 0, 0, 1.2, 20, 18, '#4b3a2a', false);
    this.block(gx, 20, 0, 1.6, 2, 22, '#6f675b', false);
  }

  house(cx, cz, w, d, h) {
    const wallC = this.P(WALL_COLORS), roofC = this.P(ROOF_COLORS);
    this.block(cx, 0, cz, w, h, d, wallC, true);
    this.block(cx, 0, cz, w + 0.3, 1.0, d + 0.3, '#8d8577', false);
    const floors = Math.max(2, Math.round(h / 3.4));
    const fh = h / floors;
    for (let i = 1; i < floors; i++) this.block(cx, i * fh - 0.15, cz, w + 0.14, 0.3, d + 0.14, TIMBER, false, 0.02);
    for (const sx of [-1, 1]) for (const sz of [-1, 1])
      this.block(cx + sx * (w / 2), 1, cz + sz * (d / 2), 0.38, h - 1, 0.38, TIMBER, false, 0.02);
    // janelas
    const win = '#2b2a33';
    const doorSide = this.rng() < 0.5 ? 1 : -1;
    for (let f = 0; f < floors; f++) {
      const y = f * fh + fh * 0.3;
      const nx = Math.max(1, Math.floor((w - 1.5) / 2.6));
      for (let i = 0; i < nx; i++) {
        const x = cx + (i - (nx - 1) / 2) * 2.6;
        for (const s of [-1, 1]) {
          if (f === 0 && s === doorSide && i === Math.floor(nx / 2)) {
            this.block(x, 0, cz + s * (d / 2 + 0.06), 1.3, 2.3, 0.14, '#5a3b26', false);
            continue;
          }
          this.block(x, y, cz + s * (d / 2 + 0.05), 1.0, 1.3, 0.12, win, false, 0.01);
        }
      }
      const nz = Math.max(1, Math.floor((d - 1.5) / 2.6));
      for (let i = 0; i < nz; i++) {
        const z = cz + (i - (nz - 1) / 2) * 2.6;
        for (const s of [-1, 1]) this.block(cx + s * (w / 2 + 0.05), y, z, 0.12, 1.3, 1.0, win, false, 0.01);
      }
    }
    // telhado
    const alongX = w >= d;
    const rh = Math.min(w, d) * 0.55;
    if (alongX) this.addGeo(roofPrism(w + 0.8, rh, d + 0.9, roofC, cx, h, cz), cx, cz);
    else this.addGeo(roofPrism(d + 0.8, rh, w + 0.9, roofC, cx, h, cz, true), cx, cz);
    // colisores do telhado (aproximação em dois degraus)
    this.addCollider(cx - w / 2, h, cz - d / 2, cx + w / 2, h + rh * 0.5, cz + d / 2, 'roof');
    if (alongX) this.addCollider(cx - w / 2, h + rh * 0.5, cz - d / 4, cx + w / 2, h + rh, cz + d / 4, 'roof');
    else this.addCollider(cx - w / 4, h + rh * 0.5, cz - d / 2, cx + w / 4, h + rh, cz + d / 2, 'roof');
    if (this.rng() < 0.55) {
      const chx = cx + (alongX ? this.R(-w / 3, w / 3) : this.R(-w / 6, w / 6));
      const chz = cz + (alongX ? this.R(-d / 6, d / 6) : this.R(-d / 3, d / 3));
      this.block(chx, h, chz, 0.9, rh + 1.2, 0.9, '#7b6f63', true);
    }
  }

  tree(x, z, s = 1, collide = true) {
    this.block(x, 0, z, 0.6 * s, 3.2 * s, 0.6 * s, '#6b4a2e', collide);
    this.block(x, 2.4 * s, z, 3.2 * s, 2.4 * s, 3.2 * s, this.P(LEAF), collide);
    this.block(x + this.R(-0.3, 0.3) * s, 4.6 * s, z + this.R(-0.3, 0.3) * s, 2.0 * s, 1.6 * s, 2.0 * s, this.P(LEAF), collide);
  }

  depot(x, y, z) {
    this.block(x, y, z, 3.2, 1.2, 2.0, '#6b4f33', true);
    this.block(x - 0.8, y + 1.2, z, 1.1, 1.1, 1.1, '#8a6a43', false);
    this.block(x + 0.7, y + 1.2, z - 0.3, 0.9, 0.9, 0.9, '#7d5e3a', false);
    for (let i = 0; i < 3; i++) this.block(x + 2.0, y, z - 0.8 + i * 0.8, 0.6, 1.6, 0.6, '#9aa3a8', false);
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.5, 0.5, 70, 8, 1, true),
      new THREE.MeshBasicMaterial({ color: '#ffcf6b', transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
    );
    beam.position.set(x, y + 35, z);
    this.group.add(beam);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(6.2, 6.8, 40).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: '#ffd27a', transparent: true, opacity: 0.6, depthWrite: false })
    );
    ring.position.set(x, y + 0.08, z);
    this.group.add(ring);
    this.depots.push({ pos: new THREE.Vector3(x, y + 1, z), radius: 7, beam, ring });
  }

  centerTower() {
    this.block(0, 0, 0, 22, 0.4, 22, '#b9ae97', false);
    this.block(0, 0, 0, 12, 30, 12, '#a49d8f', true);
    this.block(0, 30, 0, 13.2, 1.4, 13.2, '#7d776b', true);
    this.block(0, 31.4, 0, 9, 13, 9, '#b0a99a', true);
    for (const [sx, sz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      this.block(sx * 4.55, 34, sz * 4.55, sz ? 3 : 0.2, 6, sx ? 3 : 0.2, '#2f2b30', false);
    }
    const spire = new THREE.ConeGeometry(7, 18, 4).toNonIndexed();
    spire.rotateY(Math.PI / 4);
    spire.translate(0, 44.4 + 9, 0);
    spire.deleteAttribute('uv');
    const col = new THREE.Color('#5d6470');
    const arr = new Float32Array(spire.attributes.position.count * 3);
    for (let i = 0; i < arr.length; i += 3) { arr[i] = col.r; arr[i + 1] = col.g; arr[i + 2] = col.b; }
    spire.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    spire.computeVertexNormals();
    this.addGeo(spire, 0, 0);
    this.addCollider(-4.5, 44.4, -4.5, 4.5, 52, 4.5, 'roof');
    this.addCollider(-1.5, 52, -1.5, 1.5, 62, 1.5, 'roof');
    // igreja anexa
    this.house(0, 15, 10, 8, 11);
  }

  plaza(cx, cz, withDepot) {
    this.block(cx, 0, cz, 24, 0.25, 24, '#c2b59b', false, 0.02);
    if (withDepot) this.depot(cx, 0.25, cz);
    else {
      this.block(cx, 0.25, cz, 6, 1.0, 6, '#8e887c', true);
      this.block(cx, 1.25, cz, 1.2, 2.5, 1.2, '#9c968a', true);
    }
    for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) this.tree(cx + sx * 9, cz + sz * 9, this.R(1.1, 1.5));
    // barracas
    for (let i = 0; i < 2; i++) {
      const bx = cx + this.R(-6, 6), bz = cz + (i ? 6.5 : -6.5);
      this.block(bx, 0.25, bz, 3, 1, 2, '#6b4f33', true);
      this.block(bx, 2.4, bz, 3.4, 0.25, 2.4, this.P(['#b84a3a', '#d8c080', '#4a6a9a', '#e8e0d0']), true);
      for (const px of [-1.5, 1.5]) this.block(bx + px, 0.25, bz, 0.15, 2.2, 0.15, TIMBER, false);
    }
    this.plazas.push(new THREE.Vector3(cx, 0, cz));
  }

  buildCity() {
    const B = 36, R = CFG.WALL_R;
    const depotCells = new Set(['3,3', '-3,-3', '-3,3', '3,-3', '-5,0', '0,5', '0,-5']);
    for (let gx = -7; gx <= 7; gx++) {
      for (let gz = -7; gz <= 7; gz++) {
        const cx = gx * B, cz = gz * B;
        const dist = Math.hypot(cx, cz);
        if (dist > R - 24) continue;
        if (cx > R - 75 && Math.abs(cz) < 45) {
          // casas destruídas perto da brecha
          for (let k = 0; k < 5; k++) {
            const x = cx + this.R(-12, 12), z = cz + this.R(-12, 12);
            this.block(x, 0, z, this.R(3, 8), this.R(1, 5), this.R(3, 8), this.P(WALL_COLORS), true, 0.05);
          }
          for (let k = 0; k < 4; k++) this.block(cx + this.R(-12, 12), 0, cz + this.R(-12, 12), this.R(0.3, 0.5), this.R(4, 7), this.R(0.3, 0.5), TIMBER, false);
          continue;
        }
        if (gx === 0 && gz === 0) { this.centerTower(); continue; }
        const key = `${gx},${gz}`;
        if (depotCells.has(key)) { this.plaza(cx, cz, true); continue; }
        if (this.rng() < 0.07) { this.plaza(cx, cz, false); continue; }
        const centrality = 1 - dist / R;
        if (this.rng() < 0.18) {
          // prédio grande ocupando a quadra
          const w = this.R(18, 24), d = this.R(14, 22);
          this.house(cx, cz, w, d, Math.round(this.R(3, 6)) * 3.6 + centrality * 6);
          continue;
        }
        for (const i of [-1, 1]) for (const j of [-1, 1]) {
          if (this.rng() < 0.08) { this.tree(cx + i * 6.5, cz + j * 6.5, this.R(1, 1.4)); continue; }
          const w = this.R(8, 11.5), d = this.R(8, 11.5);
          const stories = Math.floor(this.R(2, 5.2 + centrality * 2));
          this.house(cx + i * 6.5 + this.R(-0.6, 0.6), cz + j * 6.5 + this.R(-0.6, 0.6), w, d, stories * 3.4);
        }
      }
    }
    // depósitos no topo da muralha (perto da brecha)
    for (const s of [-1, 1]) {
      const a = CFG.BREACH_ANGLE + s * 0.32;
      this.depot(Math.cos(a) * CFG.WALL_R, CFG.WALL_H, Math.sin(a) * CFG.WALL_R);
    }
  }

  buildForest() {
    const R = CFG.WALL_R;
    let placed = 0, tries = 0;
    const trunks = [];
    while (placed < 110 && tries < 4000) {
      tries++;
      const a = this.R(0, Math.PI * 2);
      const r = this.R(R + 38, CFG.WORLD_R - 30);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (x > R && Math.abs(z) < 30) continue; // trilha
      if (trunks.some((t) => Math.hypot(t[0] - x, t[1] - z) < 26)) continue;
      trunks.push([x, z]);
      this.giantTree(x, z);
      placed++;
    }
    // árvores pequenas
    for (let i = 0; i < 160; i++) {
      const a = this.R(0, Math.PI * 2), r = this.R(R + 20, CFG.WORLD_R + 60);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (x > R && Math.abs(z) < 25) continue;
      this.tree(x, z, this.R(1.5, 2.6));
    }
  }

  giantTree(x, z) {
    const tw = this.R(2.6, 4.6), H = this.R(48, 82);
    const bark = this.P(['#5e4430', '#6b4c33', '#56402e']);
    this.block(x, 0, z, tw, H, tw, bark, true, 0.02);
    this.block(x, 0, z, tw * 1.7, 3, tw * 1.7, bark, true, 0.02); // raízes
    const nb = 2 + Math.floor(this.rng() * 4);
    for (let i = 0; i < nb; i++) {
      const y = H * this.R(0.4, 0.78), len = this.R(6, 13), th = this.R(1, 1.6);
      const dir = this.rng() * 4 | 0;
      const dx = [1, -1, 0, 0][dir], dz = [0, 0, 1, -1][dir];
      const bx = x + dx * (tw / 2 + len / 2), bz = z + dz * (tw / 2 + len / 2);
      const sx = dx ? len : th, sz = dz ? len : th;
      this.block(bx, y, bz, sx, th, sz, bark, true, 0.02);
      this.block(x + dx * (tw / 2 + len), y + th, z + dz * (tw / 2 + len), this.R(5, 8), this.R(3, 5), this.R(5, 8), this.P(LEAF), true);
    }
    const nf = 3 + Math.floor(this.rng() * 4);
    for (let i = 0; i < nf; i++) {
      const s = this.R(8, 16);
      this.block(x + this.R(-6, 6), H * this.R(0.72, 0.98), z + this.R(-6, 6), s, s * this.R(0.5, 0.8), s, this.P(LEAF), true);
    }
  }

  buildScenery() {
    // montanhas distantes
    const geos = [];
    for (let i = 0; i < 38; i++) {
      const a = (i / 38) * Math.PI * 2 + this.R(-0.05, 0.05);
      const r = this.R(950, 1350), h = this.R(160, 380), rad = this.R(140, 260);
      const g = new THREE.ConeGeometry(rad, h, 5).toNonIndexed();
      g.deleteAttribute('uv');
      g.translate(Math.cos(a) * r, h / 2 - 5, Math.sin(a) * r);
      const c = new THREE.Color(this.P(['#7d8a78', '#6f7d6d', '#8a927f', '#737a70']));
      const arr = new Float32Array(g.attributes.position.count * 3);
      const pos = g.attributes.position;
      for (let k = 0; k < pos.count; k++) {
        const top = pos.getY(k) > h * 0.7 + (h / 2 - 5) - h / 2;
        const cc = top ? new THREE.Color('#e9edf0') : c;
        arr[k * 3] = cc.r; arr[k * 3 + 1] = cc.g; arr[k * 3 + 2] = cc.b;
      }
      g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
      g.computeVertexNormals();
      geos.push(g);
    }
    const mtn = new THREE.Mesh(mergeGeometries(geos), new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
    this.group.add(mtn);

    // nuvens blocadas
    const cg = [];
    for (let i = 0; i < 45; i++) {
      const x = this.R(-1100, 1100), z = this.R(-1100, 1100), y = this.R(190, 280);
      const n = 3 + (this.rng() * 4 | 0);
      for (let k = 0; k < n; k++)
        cg.push(coloredBox(this.R(30, 70), this.R(10, 20), this.R(25, 55), '#ffffff', x + this.R(-40, 40), y + this.R(-5, 8), z + this.R(-30, 30), 0, 0.02));
    }
    this.clouds = new THREE.Mesh(mergeGeometries(cg), new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.92, emissive: '#555b66' }));
    this.scene.add(this.clouds);

    // céu em gradiente
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(2400, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide, depthWrite: false, fog: false,
        uniforms: { top: { value: new THREE.Color('#3f7fc4') }, mid: { value: new THREE.Color('#9cc6e8') }, bot: { value: new THREE.Color('#dfe9ee') } },
        vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
        fragmentShader: 'uniform vec3 top; uniform vec3 mid; uniform vec3 bot; varying vec3 vP; void main(){ float h = vP.y; vec3 c = h>0.0 ? mix(mid, top, smoothstep(0.0,0.6,h)) : mix(mid, bot, smoothstep(0.0,-0.2,h)); gl_FragColor = vec4(c,1.0); }',
      })
    );
    this.sky = sky;
    this.scene.add(sky);
  }

  update(dt, camPos) {
    if (this.clouds) { this.clouds.position.x += dt * 2.5; if (this.clouds.position.x > 500) this.clouds.position.x = -500; }
    if (this.sky) this.sky.position.copy(camPos);
    const t = performance.now() * 0.001;
    for (const d of this.depots) d.beam.material.opacity = 0.2 + Math.sin(t * 2) * 0.06;
  }

  // ---------- consultas ----------
  nearby(x, z, out) {
    const cs = this.cellSize;
    const k = Math.floor(x / cs) * 100000 + Math.floor(z / cs);
    return this.grid.get(k) || out;
  }

  queryRadius(x, z, r) {
    const cs = this.cellSize, res = new Set();
    for (let gx = Math.floor((x - r) / cs); gx <= Math.floor((x + r) / cs); gx++)
      for (let gz = Math.floor((z - r) / cs); gz <= Math.floor((z + r) / cs); gz++) {
        const l = this.grid.get(gx * 100000 + gz);
        if (l) for (const c of l) res.add(c);
      }
    return res;
  }

  // Esfera vs mundo. Modifica pos/vel. Retorna info de contato.
  collideSphere(pos, vel, r, info) {
    info.onGround = false; info.impact = 0; info.hit = false;
    info.normal.set(0, 0, 0);
    for (let iter = 0; iter < 2; iter++) {
      // chão
      if (pos.y < r) {
        pos.y = r;
        if (vel.y < 0) { info.impact = Math.max(info.impact, -vel.y); vel.y = 0; }
        info.onGround = true; info.hit = true; info.normal.set(0, 1, 0);
      }
      // caixas
      const cs = this.cellSize;
      const seen = new Set();
      for (let gx = Math.floor((pos.x - r) / cs); gx <= Math.floor((pos.x + r) / cs); gx++)
        for (let gz = Math.floor((pos.z - r) / cs); gz <= Math.floor((pos.z + r) / cs); gz++) {
          const list = this.grid.get(gx * 100000 + gz);
          if (!list) continue;
          for (const c of list) {
            if (seen.has(c)) continue; seen.add(c);
            this.sphereBox(pos, vel, r, c.min, c.max, info);
          }
        }
      this.collideWall(pos, vel, r, info);
    }
    // limite do mundo
    const d = Math.hypot(pos.x, pos.z);
    if (d > CFG.WORLD_R + 60) {
      const k = (CFG.WORLD_R + 60) / d;
      pos.x *= k; pos.z *= k;
      _n.set(-pos.x, 0, -pos.z).normalize();
      const vn = vel.dot(_n); if (vn < 0) vel.addScaledVector(_n, -vn);
    }
    return info;
  }

  sphereBox(pos, vel, r, min, max, info) {
    if (pos.x < min.x - r || pos.x > max.x + r || pos.y < min.y - r || pos.y > max.y + r || pos.z < min.z - r || pos.z > max.z + r) return;
    const cx = clamp(pos.x, min.x, max.x), cy = clamp(pos.y, min.y, max.y), cz = clamp(pos.z, min.z, max.z);
    let dx = pos.x - cx, dy = pos.y - cy, dz = pos.z - cz;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > r * r) return;
    let pen;
    if (d2 > 1e-8) {
      const d = Math.sqrt(d2);
      _n.set(dx / d, dy / d, dz / d);
      pen = r - d;
    } else {
      // centro dentro da caixa: empurra pelo menor eixo
      const px = Math.min(pos.x - min.x, max.x - pos.x), py = Math.min(pos.y - min.y, max.y - pos.y), pz = Math.min(pos.z - min.z, max.z - pos.z);
      if (py <= px && py <= pz) { _n.set(0, pos.y - min.y < max.y - pos.y ? -1 : 1, 0); pen = py + r; }
      else if (px <= pz) { _n.set(pos.x - min.x < max.x - pos.x ? -1 : 1, 0, 0); pen = px + r; }
      else { _n.set(0, 0, pos.z - min.z < max.z - pos.z ? -1 : 1); pen = pz + r; }
    }
    pos.addScaledVector(_n, pen);
    const vn = vel.dot(_n);
    if (vn < 0) { info.impact = Math.max(info.impact, -vn); vel.addScaledVector(_n, -vn); }
    if (_n.y > 0.55) info.onGround = true;
    info.hit = true;
    info.normal.add(_n);
  }

  collideWall(pos, vel, r, info) {
    const { WALL_R: R, WALL_H: H, WALL_T: T } = CFG;
    const rr = Math.hypot(pos.x, pos.z);
    const inner = R - T / 2, outer = R + T / 2;
    if (rr < inner - r || rr > outer + r || pos.y - r > H) return;
    const ang = Math.atan2(pos.z, pos.x);
    if (Math.abs(angleDiff(ang, CFG.BREACH_ANGLE)) < CFG.BREACH_HALF + 0.012) return;
    const dIn = rr - (inner - r), dOut = outer + r - rr, dTop = H - (pos.y - r);
    _v.set(pos.x / rr, 0, pos.z / rr);
    if (dTop < dIn && dTop < dOut) { pos.y = H + r; _n.set(0, 1, 0); info.onGround = true; }
    else if (dIn < dOut) { pos.addScaledVector(_v, -dIn); _n.copy(_v).negate(); }
    else { pos.addScaledVector(_v, dOut); _n.copy(_v); }
    const vn = vel.dot(_n);
    if (vn < 0) { info.impact = Math.max(info.impact, -vn); vel.addScaledVector(_n, -vn); }
    info.hit = true;
    info.normal.add(_n);
  }

  // Raycast estático. Retorna {t, point, normal} ou null.
  raycast(o, d, maxT) {
    let bestT = maxT, found = false;
    const bestN = new THREE.Vector3();
    const n = new THREE.Vector3();
    for (const c of this.colliders) {
      const t = rayAABB(o, d, c.min, c.max, bestT, n);
      if (t >= 0 && t < bestT) { bestT = t; bestN.copy(n); found = true; }
    }
    // chão
    if (d.y < -1e-6) {
      const t = -o.y / d.y;
      if (t > 0 && t < bestT) { bestT = t; bestN.set(0, 1, 0); found = true; }
    }
    // muralha
    const wt = this.rayWall(o, d, bestT, n);
    if (wt >= 0 && wt < bestT) { bestT = wt; bestN.copy(n); found = true; }
    if (!found) return null;
    return { t: bestT, point: o.clone().addScaledVector(d, bestT), normal: bestN };
  }

  rayWall(o, d, maxT, outN) {
    const { WALL_R: R, WALL_H: H, WALL_T: T } = CFG;
    let best = -1;
    const a = d.x * d.x + d.z * d.z;
    const test = (t, radial, sign) => {
      if (t <= 0 || t >= maxT || (best >= 0 && t >= best)) return;
      const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
      if (y < 0 || y > H) return;
      if (this.inBreach(Math.atan2(z, x))) return;
      if (!radial) { const rr = Math.hypot(x, z); if (rr < R - T / 2 || rr > R + T / 2) return; }
      best = t;
      if (radial) { const rr = Math.hypot(x, z); outN.set((x / rr) * sign, 0, (z / rr) * sign); }
      else outN.set(0, 1, 0);
    };
    if (a > 1e-9) {
      for (const [rad, sign] of [[R - T / 2, -1], [R + T / 2, 1]]) {
        const b = 2 * (o.x * d.x + o.z * d.z), c = o.x * o.x + o.z * o.z - rad * rad;
        const disc = b * b - 4 * a * c;
        if (disc < 0) continue;
        const sq = Math.sqrt(disc);
        const t1 = (-b - sq) / (2 * a), t2 = (-b + sq) / (2 * a);
        // de dentro do círculo interno, acerta a face interna (normal para dentro)
        test(t1, true, sign); test(t2, true, sign);
      }
    }
    if (Math.abs(d.y) > 1e-6) test((H - o.y) / d.y, false, 1);
    return best;
  }

  isInside(x, z) { return Math.hypot(x, z) < CFG.WALL_R; }
}
