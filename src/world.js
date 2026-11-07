import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CFG } from './config.js';
import { coloredBox, roofPrism, rayAABB, mulberry32, angleDiff, clamp } from './util.js';
import { getBlenderGeo } from './assets.js';
import {
  getPlasterTextures,
  getRoofTextures,
  getStoneWallTextures,
  getCobbleTextures,
  getGrassTextures,
  getTimberTexture,
  getWindowTexture,
  getBarkTextures,
} from './textures.js';

const WALL_COLORS = ['#efe5cf', '#f4ebd8', '#e2d3b5', '#eadbc0', '#d8ccb6', '#f6efe0', '#dfd4bf', '#ecdec6'];
const ROOF_COLORS = ['#a84c32', '#943d2b', '#b45d3d', '#784e3d', '#5c6675', '#88382a', '#bc6640', '#914735'];
const SHUTTER_COLORS = ['#385842', '#6b3b2e', '#3b4f66', '#543b2a'];
const TIMBER = '#452e1f';
const STONE = ['#9e988c', '#908a7e', '#a8a194', '#898378'];
const LEAF = ['#53873c', '#457832', '#609444', '#4a7f37', '#3c6d2d'];

const _n = new THREE.Vector3();
const _v = new THREE.Vector3();
const _m4 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s3 = new THREE.Vector3();
const _p3 = new THREE.Vector3();
const _col = new THREE.Color();

// Normaliza qualquer BufferGeometry (inclusive do Blender) para formato idêntico compatível com mergeGeometries
function toMergeable(srcGeo, pos, rotY = 0, scale = null, tintHex = '#ffffff', jitter = 0) {
  let g = srcGeo.index ? srcGeo.toNonIndexed() : srcGeo.clone();
  // Mantém apenas position, normal, uv, color na mesma ordem
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  const count = g.attributes.position.count;
  if (!g.getAttribute('uv')) {
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
  }
  _q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY);
  _p3.set(pos[0], pos[1], pos[2]);
  _s3.set(scale ? scale[0] : 1, scale ? scale[1] : 1, scale ? scale[2] : 1);
  _m4.compose(_p3, _q, _s3);
  g.applyMatrix4(_m4);

  _col.set(tintHex);
  if (jitter) _col.offsetHSL(0, 0, (Math.random() * 2 - 1) * jitter);
  const existingCol = g.getAttribute('color');
  const outCol = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const cr = existingCol ? existingCol.getX(i) : 1;
    const cg = existingCol ? existingCol.getY(i) : 1;
    const cb = existingCol ? existingCol.getZ(i) : 1;
    outCol[i * 3] = cr * _col.r;
    outCol[i * 3 + 1] = cg * _col.g;
    outCol[i * 3 + 2] = cb * _col.b;
  }
  // Reconstrói BufferGeometry limpa só com os 4 atributos padrão
  const clean = new THREE.BufferGeometry();
  clean.setAttribute('position', g.getAttribute('position'));
  clean.setAttribute('normal', g.getAttribute('normal'));
  clean.setAttribute('uv', g.getAttribute('uv'));
  clean.setAttribute('color', new THREE.BufferAttribute(outCol, 3));
  return clean;
}

function normalizeStdGeo(g) {
  const clean = new THREE.BufferGeometry();
  clean.setAttribute('position', g.getAttribute('position'));
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  clean.setAttribute('normal', g.getAttribute('normal'));
  const count = g.attributes.position.count;
  clean.setAttribute('uv', g.getAttribute('uv') || new THREE.BufferAttribute(new Float32Array(count * 2), 2));
  clean.setAttribute('color', g.getAttribute('color') || new THREE.BufferAttribute(new Float32Array(count * 3).fill(1), 3));
  return clean;
}

export class World {
  constructor(scene) {
    this.scene = scene;
    this.colliders = [];
    this.grid = new Map();
    this.cellSize = 24;
    this.depots = [];
    this.buckets = new Map(); // matKey -> Map(chunkKey -> Geo[])
    this.propInstances = { wall_cannon: [], street_lamp: [], supply_wagon: [], fountain: [] };
    this.plazas = [];
    this.rng = mulberry32(20261105);

    const plaster = getPlasterTextures();
    const roof = getRoofTextures();
    const stone = getStoneWallTextures();
    const timber = getTimberTexture();
    const winTex = getWindowTexture();
    const bark = getBarkTextures();

    this.materials = {
      plaster: new THREE.MeshStandardMaterial({ map: plaster.map, bumpMap: plaster.bumpMap, bumpScale: 0.04, vertexColors: true, roughness: 0.86, metalness: 0.02 }),
      roof: new THREE.MeshStandardMaterial({ map: roof.map, bumpMap: roof.bumpMap, bumpScale: 0.09, vertexColors: true, roughness: 0.72, metalness: 0.04 }),
      stone: new THREE.MeshStandardMaterial({ map: stone.map, bumpMap: stone.bumpMap, bumpScale: 0.12, vertexColors: true, roughness: 0.84, metalness: 0.04 }),
      timber: new THREE.MeshStandardMaterial({ map: timber, vertexColors: true, roughness: 0.80, metalness: 0.03 }),
      window: new THREE.MeshStandardMaterial({ map: winTex, vertexColors: true, roughness: 0.20, metalness: 0.36 }),
      bark: new THREE.MeshStandardMaterial({ map: bark.map, bumpMap: bark.bumpMap, bumpScale: 0.14, vertexColors: true, roughness: 0.88, metalness: 0.01 }),
      foliage: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.76, metalness: 0.01 }),
      prop: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.58, metalness: 0.22 }),
    };

    this.group = new THREE.Group();
    scene.add(this.group);
    this.build();
  }

  R(a, b) { return a + this.rng() * (b - a); }
  P(arr) { return arr[Math.floor(this.rng() * arr.length)]; }

  addGeo(g, x, z, bucket = 'plaster') {
    if (!this.buckets.has(bucket)) this.buckets.set(bucket, new Map());
    const chMap = this.buckets.get(bucket);
    const key = `${Math.floor(x / 130)},${Math.floor(z / 130)}`;
    if (!chMap.has(key)) chMap.set(key, []);
    chMap.get(key).push(normalizeStdGeo(g));
  }

  addProp(kind, x, y, z, rotY = 0, scale = 1) {
    if (this.propInstances[kind]) {
      this.propInstances[kind].push({ x, y, z, rotY, scale });
    }
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

  block(cx, y0, cz, sx, sy, sz, color, collide = false, jitter = 0.03, bucket = 'plaster', uvTile = 4.0, rotY = 0, rotZ = 0) {
    this.addGeo(coloredBox(sx, sy, sz, color, cx, y0 + sy / 2, cz, rotY, jitter, uvTile, rotZ), cx, cz, bucket);
    if (collide) this.addCollider(cx - sx / 2, y0, cz - sz / 2, cx + sx / 2, y0 + sy, cz + sz / 2);
  }

  build() {
    this.buildGround();
    this.buildWall();
    this.buildCity();
    this.buildForest();
    this.buildPropsInstanced();
    this.buildScenery();

    for (const [bucket, chMap] of this.buckets) {
      const mat = this.materials[bucket] || this.materials.plaster;
      for (const [, geos] of chMap) {
        if (!geos.length) continue;
        const merged = mergeGeometries(geos, false);
        const mesh = new THREE.Mesh(merged, mat);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.group.add(mesh);
        geos.forEach((g) => g.dispose());
      }
    }
    this.buckets.clear();
  }

  buildPropsInstanced() {
    const dummy = new THREE.Object3D();
    for (const [kind, list] of Object.entries(this.propInstances)) {
      const geo = getBlenderGeo(kind);
      if (!geo || list.length === 0) continue;
      const inst = new THREE.InstancedMesh(geo, this.materials.prop, list.length);
      inst.castShadow = true;
      inst.receiveShadow = true;
      list.forEach((it, idx) => {
        dummy.position.set(it.x, it.y, it.z);
        dummy.rotation.set(0, it.rotY, 0);
        dummy.scale.setScalar(it.scale);
        dummy.updateMatrix();
        inst.setMatrixAt(idx, dummy.matrix);
      });
      inst.instanceMatrix.needsUpdate = true;
      this.group.add(inst);
    }
  }

  buildGround() {
    const grassT = getGrassTextures(165, 165);
    const grass = new THREE.Mesh(
      new THREE.CircleGeometry(1650, 72).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ map: grassT.map, roughness: 0.92, metalness: 0.0 })
    );
    grass.receiveShadow = true;
    this.group.add(grass);

    const cobbleT = getCobbleTextures(115, 115);
    const city = new THREE.Mesh(
      new THREE.CircleGeometry(CFG.WALL_R + 2, 96).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({
        map: cobbleT.map,
        bumpMap: cobbleT.bumpMap,
        bumpScale: 0.05,
        color: '#cfc5b4',
        roughness: 0.86,
        metalness: 0.02,
      })
    );
    city.position.y = 0.02;
    city.receiveShadow = true;
    this.group.add(city);

    // Estrada de terra batida saindo da brecha
    const path = new THREE.Mesh(
      new THREE.PlaneGeometry(340, 26).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: '#9c8864', roughness: 0.95 })
    );
    path.position.set(CFG.WALL_R + 160, 0.03, 0);
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
      this.addGeo(coloredBox(T, H, seg, col, x, H / 2, z, rot, 0.02, 6.0), x, z, 'stone');
      // Sapata escalonada e cintas horizontais da Muralha (estilo Shiganshina/Trost)
      this.addGeo(coloredBox(T + 1.8, 4.5, seg, '#847e73', x, 2.25, z, rot, 0.02, 6.0), x, z, 'stone');
      this.addGeo(coloredBox(T + 0.8, 1.4, seg, '#7e786e', x, H * 0.52, z, rot, 0.02, 6.0), x, z, 'stone');
      this.addGeo(coloredBox(T + 1.1, 1.6, seg, '#8c867b', x, H - 0.8, z, rot, 0.02, 6.0), x, z, 'stone');

      // Pilastras / contrafortes verticais icônicos da Muralha do AoT a cada 2 segmentos
      if (i % 2 === 0) {
        this.addGeo(coloredBox(T + 2.4, H - 1.2, seg * 0.34, '#8e887c', x, (H - 1.2) / 2, z, rot, 0.02, 6.0), x, z, 'stone');
      }

      // Ameias (lado externo e interno)
      for (const off of [T / 2 - 0.4, -T / 2 + 0.4]) {
        const ox = x + Math.cos(a) * off, oz = z + Math.sin(a) * off;
        this.addGeo(coloredBox(0.85, 1.9, seg * 0.46, '#969084', ox, H + 0.95, oz, rot, 0.025, 4.0), ox, oz, 'stone');
      }

      // Canhões da Guarnição sobre o topo da Muralha (especialmente próximos à brecha e portão)
      if (i % 10 === 0) {
        const outward = Math.atan2(Math.sin(a), Math.cos(a));
        this.addProp('wall_cannon', x + Math.cos(a) * 1.4, H, z + Math.sin(a) * 1.4, Math.PI / 2 - outward, 1.05);
      }
    }
    // Bordas rompidas da brecha
    for (const s of [-1, 1]) {
      const a = CFG.BREACH_ANGLE + s * (CFG.BREACH_HALF + 0.012);
      const x = Math.cos(a) * R, z = Math.sin(a) * R;
      this.addCollider(x - T / 2 - 1, 0, z - 2.5, x + T / 2 + 1, H, z + 2.5, 'wall');
      for (let k = 0; k < 8; k++) {
        const y = this.R(0, H);
        this.addGeo(coloredBox(this.R(3, 7), this.R(3, 8), this.R(2, 5), this.P(STONE), x + this.R(-3, 3), y, z - s * this.R(0, 2), this.R(0, 1), 0.03, 5.0), x, z, 'stone');
      }
    }
    // Escombros de pedra da brecha
    for (let k = 0; k < 70; k++) {
      const a = CFG.BREACH_ANGLE + this.R(-CFG.BREACH_HALF * 1.6, CFG.BREACH_HALF * 1.6);
      const r = R + this.R(-28, 30);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const sx = this.R(1.5, 5.5), sy = this.R(1, 4.5), sz = this.R(1.5, 5.5);
      const big = this.rng() < 0.35;
      this.block(x, 0, z, big ? sx * 1.6 : sx, big ? sy * 1.4 : sy, big ? sz * 1.6 : sz, this.P(STONE), true, 0.05, 'stone', 4.5);
    }
    // Portão monumental de madeira ferrada e arco de pedra (lado oeste)
    const ga = Math.PI;
    const gx = Math.cos(ga) * (R - T / 2 - 0.3);
    this.block(gx, 0, 0, 1.4, 21, 18, '#4e3927', false, 0.02, 'timber', 3.5);
    this.block(gx, 21, 0, 2.2, 3.0, 23, '#7a7367', false, 0.02, 'stone', 4.5);
    for (const sz of [-10.2, 10.2]) {
      this.block(gx + 0.4, 0, sz, 2.6, 24, 2.8, '#857e72', false, 0.02, 'stone', 4.5);
    }
  }

  house(cx, cz, w, d, h) {
    const wallC = this.P(WALL_COLORS), roofC = this.P(ROOF_COLORS), shutterC = this.P(SHUTTER_COLORS);
    const floors = Math.max(2, Math.round(h / 3.4));
    const fh = h / floors;
    const jetty = floors >= 3 && this.rng() < 0.48 ? 0.30 : 0; // Sobrado germânico em balanço (Trost)

    // Colisor principal limpo para ganchos e física
    this.addCollider(cx - w / 2, 0, cz - d / 2, cx + w / 2, h, cz + d / 2);

    // 1. Base de alvenaria de pedra + térreo
    this.addGeo(coloredBox(w + 0.34, 1.18, d + 0.34, '#8f887a', cx, 0.59, cz, 0, 0.02, 3.5), cx, cz, 'stone');
    this.addGeo(coloredBox(w, fh, d, wallC, cx, fh / 2, cz, 0, 0.025, 4.2), cx, cz, 'plaster');

    // 2. Pavimentos superiores (com ou sem balanço jetty sobre mísulas de madeira)
    const uw = w + jetty * 2, ud = d + jetty * 2;
    const upperH = h - fh;
    if (upperH > 0.2) {
      this.addGeo(coloredBox(uw, upperH, ud, wallC, cx, fh + upperH / 2, cz, 0, 0.025, 4.2), cx, cz, 'plaster');
    }

    // 3. Enxaimel Tudor/Germânico (vigas horizontais, pilares de canto e mãos-francesas diagonais)
    for (let i = 1; i <= floors; i++) {
      const bw = i === 1 ? uw + 0.18 : uw + 0.16;
      const bd = i === 1 ? ud + 0.18 : ud + 0.16;
      this.block(cx, i * fh - 0.16, cz, bw, 0.30, bd, TIMBER, false, 0.015, 'timber', 3.0);
    }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      this.block(cx + sx * (w / 2), 1.1, cz + sz * (d / 2), 0.34, fh - 1.0, 0.34, TIMBER, false, 0.015, 'timber', 3.0);
      if (upperH > 0.2) {
        this.block(cx + sx * (uw / 2), fh, cz + sz * (ud / 2), 0.36, upperH, 0.36, TIMBER, false, 0.015, 'timber', 3.0);
      }
    }

    // Vigas diagonais características de Shiganshina/Trost encaixadas nos cantos do último pavimento
    if (floors >= 2) {
      const diagY = (floors - 1) * fh + fh * 0.5;
      const diagLen = fh * 0.72;
      for (const s of [-1, 1]) {
        for (const sideX of [-1, 1]) {
          this.addGeo(
            coloredBox(0.16, diagLen, 0.12, TIMBER, cx + sideX * (uw / 2 - 0.78), diagY, cz + s * (ud / 2 + 0.04), 0, 0.01, 2.0, sideX * 0.42),
            cx, cz, 'timber'
          );
        }
      }
    }

    // 4. Janelas envidraçadas com peitoril de pedra + venezianas de madeira e porta
    const doorSide = this.rng() < 0.5 ? 1 : -1;
    const hasShutters = this.rng() < 0.65;
    for (let f = 0; f < floors; f++) {
      const fw = f === 0 ? w : uw;
      const fd = f === 0 ? d : ud;
      const y = f * fh + fh * 0.28;
      const nx = Math.max(1, Math.floor((fw - 1.8) / 2.7));
      for (let i = 0; i < nx; i++) {
        const x = cx + (i - (nx - 1) / 2) * 2.7;
        for (const s of [-1, 1]) {
          const zFace = cz + s * (fd / 2 + 0.05);
          if (f === 0 && s === doorSide && i === Math.floor(nx / 2)) {
            this.block(x, 0, zFace, 1.38, 2.42, 0.16, '#5c3c24', false, 0.02, 'timber', 2.0);
            this.block(x, 2.40, zFace, 1.62, 0.24, 0.26, '#847d70', false, 0.02, 'stone', 2.0);
            this.block(x, 0, zFace + s * 0.18, 1.65, 0.22, 0.42, '#8a8376', false, 0.02, 'stone', 2.0);
            continue;
          }
          // Vidraça quadriculada (uvTile=0 mantém UV 0..1 inteira na janela!)
          this.block(x, y, zFace, 1.05, 1.38, 0.10, '#ffffff', false, 0.01, 'window', 0);
          // Peitoril de pedra
          this.block(x, y - 0.12, zFace + s * 0.04, 1.26, 0.14, 0.22, '#8c8578', false, 0.02, 'stone', 2.0);
          if (hasShutters && f > 0) {
            for (const shS of [-1, 1]) {
              this.block(x + shS * 0.68, y + 0.02, zFace + s * 0.02, 0.28, 1.32, 0.08, shutterC, false, 0.02, 'timber', 1.5);
            }
          }
        }
      }
      const nz = Math.max(1, Math.floor((fd - 1.8) / 2.7));
      for (let i = 0; i < nz; i++) {
        const z = cz + (i - (nz - 1) / 2) * 2.7;
        for (const s of [-1, 1]) {
          const xFace = cx + s * (fw / 2 + 0.05);
          this.block(xFace, y, z, 0.10, 1.38, 1.05, '#ffffff', false, 0.01, 'window', 0);
          this.block(xFace + s * 0.04, y - 0.12, z, 0.22, 0.14, 1.26, '#8c8578', false, 0.02, 'stone', 2.0);
        }
      }
    }

    // 5. Telhado com beiral largo, cumeeira de madeira/cerâmica e chaminé de pedra
    const alongX = uw >= ud;
    const rh = Math.min(uw, ud) * 0.58;
    const rw = (alongX ? uw : ud) + 1.15;
    const rd = (alongX ? ud : uw) + 1.25;
    if (alongX) {
      this.addGeo(roofPrism(rw, rh, rd, roofC, cx, h, cz, false), cx, cz, 'roof');
      // Cumeeira e beirais
      this.block(cx, h + rh - 0.14, cz, rw + 0.12, 0.28, 0.32, TIMBER, false, 0.01, 'timber', 3.0);
      for (const s of [-1, 1]) this.block(cx, h - 0.08, cz + s * (rd / 2), rw, 0.22, 0.20, TIMBER, false, 0.01, 'timber', 3.0);
    } else {
      this.addGeo(roofPrism(rw, rh, rd, roofC, cx, h, cz, true), cx, cz, 'roof');
      this.block(cx, h + rh - 0.14, cz, 0.32, 0.28, rw + 0.12, TIMBER, false, 0.01, 'timber', 3.0);
      for (const s of [-1, 1]) this.block(cx + s * (rd / 2), h - 0.08, cz, 0.20, 0.22, rw, TIMBER, false, 0.01, 'timber', 3.0);
    }

    // Colisores do telhado
    this.addCollider(cx - uw / 2, h, cz - ud / 2, cx + uw / 2, h + rh * 0.5, cz + ud / 2, 'roof');
    if (alongX) this.addCollider(cx - uw / 2, h + rh * 0.5, cz - ud / 4, cx + uw / 2, h + rh, cz + ud / 4, 'roof');
    else this.addCollider(cx - uw / 4, h + rh * 0.5, cz - ud / 2, cx + uw / 4, h + rh, cz + ud / 2, 'roof');

    // Chaminé detalhada (excelente ponto de gancho!)
    if (this.rng() < 0.65) {
      const chx = cx + (alongX ? this.R(-uw / 3, uw / 3) : this.R(-uw / 6, uw / 6));
      const chz = cz + (alongX ? this.R(-ud / 6, ud / 6) : this.R(-ud / 3, ud / 3));
      const chH = rh + 1.5;
      this.block(chx, h, chz, 0.95, chH, 0.95, '#867b6f', true, 0.02, 'stone', 2.5);
      this.block(chx, h + chH, chz, 1.18, 0.22, 1.18, '#6e655b', false, 0.02, 'stone', 2.0);
    }
  }

  tree(x, z, s = 1, collide = true) {
    const trunkGeo = getBlenderGeo('giant_tree_trunk');
    const canopyGeo = getBlenderGeo('foliage_cluster');
    const barkC = '#6b4c32';
    const leafC = this.P(LEAF);
    if (trunkGeo && canopyGeo) {
      this.addGeo(toMergeable(trunkGeo, [x, 0, z], this.R(0, 6.28), [0.65 * s, 3.3 * s, 0.65 * s], barkC, 0.02), x, z, 'bark');
      this.addGeo(toMergeable(canopyGeo, [x, 3.6 * s, z], this.R(0, 6.28), [3.5 * s, 3.0 * s, 3.5 * s], leafC, 0.03), x, z, 'foliage');
      this.addGeo(toMergeable(canopyGeo, [x + this.R(-0.3, 0.3) * s, 5.1 * s, z + this.R(-0.3, 0.3) * s], this.R(0, 6.28), [2.3 * s, 2.0 * s, 2.3 * s], this.P(LEAF), 0.03), x, z, 'foliage');
      if (collide) {
        this.addCollider(x - 0.35 * s, 0, z - 0.35 * s, x + 0.35 * s, 3.2 * s, z + 0.35 * s);
        this.addCollider(x - 1.5 * s, 2.4 * s, z - 1.5 * s, x + 1.5 * s, 5.6 * s, z + 1.5 * s);
      }
    } else {
      this.block(x, 0, z, 0.6 * s, 3.2 * s, 0.6 * s, barkC, collide, 0.02, 'bark');
      this.block(x, 2.4 * s, z, 3.2 * s, 2.4 * s, 3.2 * s, leafC, collide, 0.03, 'foliage');
    }
  }

  depot(x, y, z) {
    this.block(x, y, z, 3.2, 1.2, 2.0, '#6b4f33', true, 0.02, 'timber', 2.5);
    this.block(x - 0.8, y + 1.2, z, 1.1, 1.1, 1.1, '#8a6a43', false, 0.02, 'timber', 2.0);
    this.block(x + 0.7, y + 1.2, z - 0.3, 0.9, 0.9, 0.9, '#7d5e3a', false, 0.02, 'timber', 2.0);
    for (let i = 0; i < 3; i++) this.block(x + 2.0, y, z - 0.8 + i * 0.8, 0.6, 1.6, 0.6, '#b4bec4', false, 0.01, 'stone', 2.0);
    if (y < 5) this.addProp('supply_wagon', x - 3.6, y, z + 1.2, 0.4, 0.95);

    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.5, 0.5, 70, 12, 1, true),
      new THREE.MeshBasicMaterial({ color: '#ffd478', transparent: true, opacity: 0.24, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
    );
    beam.position.set(x, y + 35, z);
    this.group.add(beam);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(6.2, 6.8, 48).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: '#ffe094', transparent: true, opacity: 0.65, depthWrite: false })
    );
    ring.position.set(x, y + 0.08, z);
    this.group.add(ring);
    this.depots.push({ pos: new THREE.Vector3(x, y + 1, z), radius: 7, beam, ring });
  }

  centerTower() {
    this.block(0, 0, 0, 24, 0.42, 24, '#b8ae98', false, 0.02, 'stone', 4.5);
    this.block(0, 0, 0, 12.4, 30, 12.4, '#a69f91', true, 0.02, 'stone', 5.0);
    // Contrafortes de canto da Catedral/Torre
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      this.block(sx * 6.2, 0, sz * 6.2, 1.4, 29, 1.4, '#8d8679', false, 0.02, 'stone', 4.0);
    }
    this.block(0, 30, 0, 13.8, 1.5, 13.8, '#7e786c', true, 0.02, 'stone', 4.0);
    this.block(0, 31.5, 0, 9.2, 13, 9.2, '#b2ab9c', true, 0.02, 'stone', 4.5);
    for (const [sx, sz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      this.block(sx * 4.65, 34, sz * 4.65, sz ? 2.8 : 0.16, 6, sx ? 2.8 : 0.16, '#ffffff', false, 0.01, 'window', 0);
    }
    const spire = new THREE.ConeGeometry(7.2, 18.5, 4).toNonIndexed();
    spire.rotateY(Math.PI / 4);
    spire.translate(0, 44.5 + 9.25, 0);
    const col = new THREE.Color('#56606e');
    const count = spire.attributes.position.count;
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) { arr[i * 3] = col.r; arr[i * 3 + 1] = col.g; arr[i * 3 + 2] = col.b; }
    spire.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    spire.computeVertexNormals();
    this.addGeo(spire, 0, 0, 'roof');
    this.addCollider(-4.5, 44.4, -4.5, 4.5, 52, 4.5, 'roof');
    this.addCollider(-1.5, 52, -1.5, 1.5, 62, 1.5, 'roof');
    // Postes de rua ao redor da torre central
    for (const [lx, lz] of [[-10, -10], [10, -10], [-10, 10], [10, 10]]) {
      this.addProp('street_lamp', lx, 0.4, lz, 0, 1.0);
    }
    // Nave da catedral anexa
    this.house(0, 15, 10, 8, 11);
  }

  plaza(cx, cz, withDepot) {
    this.block(cx, 0, cz, 25, 0.25, 25, '#bdb29c', false, 0.02, 'stone', 4.5);
    if (withDepot) this.depot(cx, 0.25, cz);
    else {
      this.addProp('fountain', cx, 0.25, cz, 0, 1.05);
      this.addCollider(cx - 2.8, 0.25, cz - 2.8, cx + 2.8, 1.4, cz + 2.8);
      this.addCollider(cx - 0.8, 1.4, cz - 0.8, cx + 0.8, 3.4, cz + 0.8);
    }
    for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      this.tree(cx + sx * 9.2, cz + sz * 9.2, this.R(1.1, 1.45));
      this.addProp('street_lamp', cx + sx * 11.2, 0.25, cz + sz * 5.2, 0, 0.95);
    }
    // Tendas de feira
    for (let i = 0; i < 2; i++) {
      const bx = cx + this.R(-6, 6), bz = cz + (i ? 6.8 : -6.8);
      this.block(bx, 0.25, bz, 3, 1, 2, '#6b4f33', true, 0.02, 'timber', 2.5);
      this.block(bx, 2.4, bz, 3.5, 0.26, 2.5, this.P(['#b84a3a', '#dfd098', '#486c9c', '#eee6d6']), true, 0.02, 'plaster', 3.0);
      for (const px of [-1.5, 1.5]) this.block(bx + px, 0.25, bz, 0.16, 2.2, 0.16, TIMBER, false, 0.01, 'timber', 2.0);
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
          // Quarteirões destruídos perto da brecha
          for (let k = 0; k < 5; k++) {
            const x = cx + this.R(-12, 12), z = cz + this.R(-12, 12);
            this.block(x, 0, z, this.R(3, 8), this.R(1, 5), this.R(3, 8), this.P(WALL_COLORS), true, 0.05, 'plaster', 4.0);
          }
          for (let k = 0; k < 4; k++) this.block(cx + this.R(-12, 12), 0, cz + this.R(-12, 12), this.R(0.3, 0.5), this.R(4, 7), this.R(0.3, 0.5), TIMBER, false, 0.02, 'timber', 2.5);
          continue;
        }
        if (gx === 0 && gz === 0) { this.centerTower(); continue; }
        const key = `${gx},${gz}`;
        if (depotCells.has(key)) { this.plaza(cx, cz, true); continue; }
        if (this.rng() < 0.07) { this.plaza(cx, cz, false); continue; }

        // Calçada elevada de pedra sob cada quadra urbana (cria ruas bem definidas entre as quadras!)
        this.block(cx, 0, cz, 27.5, 0.18, 27.5, '#a8a092', false, 0.015, 'stone', 4.5);
        if ((gx + gz) % 2 === 0) {
          this.addProp('street_lamp', cx + 13.2, 0.18, cz + 13.2, 0, 0.92);
        }

        const centrality = 1 - dist / R;
        if (this.rng() < 0.18) {
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
    // Depósitos no topo da muralha perto da brecha
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
      if (x > R && Math.abs(z) < 30) continue;
      if (trunks.some((t) => Math.hypot(t[0] - x, t[1] - z) < 26)) continue;
      trunks.push([x, z]);
      this.giantTree(x, z);
      placed++;
    }
    for (let i = 0; i < 160; i++) {
      const a = this.R(0, Math.PI * 2), r = this.R(R + 20, CFG.WORLD_R + 60);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (x > R && Math.abs(z) < 25) continue;
      this.tree(x, z, this.R(1.5, 2.6));
    }
  }

  giantTree(x, z) {
    const tw = this.R(2.8, 4.8), H = this.R(50, 84);
    const bark = this.P(['#664934', '#73533a', '#5c4330']);
    const trunkGeo = getBlenderGeo('giant_tree_trunk');
    const canopyGeo = getBlenderGeo('foliage_cluster');

    if (trunkGeo) {
      this.addGeo(toMergeable(trunkGeo, [x, 0, z], this.R(0, 6.28), [tw * 1.12, H, tw * 1.12], bark, 0.02), x, z, 'bark');
      this.addCollider(x - tw * 0.48, 0, z - tw * 0.48, x + tw * 0.48, H, z + tw * 0.48);
      this.addCollider(x - tw * 0.82, 0, z - tw * 0.82, x + tw * 0.82, 3.2, z + tw * 0.82);
    } else {
      this.block(x, 0, z, tw, H, tw, bark, true, 0.02, 'bark');
    }

    const nb = 2 + Math.floor(this.rng() * 4);
    for (let i = 0; i < nb; i++) {
      const y = H * this.R(0.42, 0.78), len = this.R(6.5, 13.5), th = this.R(1.0, 1.6);
      const dir = this.rng() * 4 | 0;
      const dx = [1, -1, 0, 0][dir], dz = [0, 0, 1, -1][dir];
      const bx = x + dx * (tw / 2 + len / 2), bz = z + dz * (tw / 2 + len / 2);
      const sx = dx ? len : th, sz = dz ? len : th;
      // Galho grosso (ótimo para pousar como no anime e no mapa Forest do RAoT!)
      this.block(bx, y, bz, sx, th, sz, bark, true, 0.02, 'bark', 3.0);
      const tipX = x + dx * (tw / 2 + len), tipZ = z + dz * (tw / 2 + len);
      const csx = this.R(5.5, 8.5), csy = this.R(3.5, 5.5);
      if (canopyGeo) {
        this.addGeo(toMergeable(canopyGeo, [tipX, y + th + csy * 0.35, tipZ], this.R(0, 6.28), [csx, csy, csx], this.P(LEAF), 0.03), tipX, tipZ, 'foliage');
        this.addCollider(tipX - csx * 0.42, y + th, tipZ - csx * 0.42, tipX + csx * 0.42, y + th + csy * 0.75, tipZ + csx * 0.42);
      } else {
        this.block(tipX, y + th, tipZ, csx, csy, csx, this.P(LEAF), true, 0.03, 'foliage');
      }
    }

    const nf = 4 + Math.floor(this.rng() * 4);
    for (let i = 0; i < nf; i++) {
      const s = this.R(9, 17);
      const fx = x + this.R(-6, 6), fy = H * this.R(0.74, 0.99), fz = z + this.R(-6, 6);
      const sy = s * this.R(0.55, 0.82);
      if (canopyGeo) {
        this.addGeo(toMergeable(canopyGeo, [fx, fy + sy * 0.3, fz], this.R(0, 6.28), [s, sy, s], this.P(LEAF), 0.03), fx, fz, 'foliage');
        this.addCollider(fx - s * 0.4, fy, fz - s * 0.4, fx + s * 0.4, fy + sy * 0.7, fz + s * 0.4);
      } else {
        this.block(fx, fy, fz, s, sy, s, this.P(LEAF), true, 0.03, 'foliage');
      }
    }
  }

  buildScenery() {
    // Cordilheira alpina distante com múltiplos cumes e perspectiva atmosférica azulada
    const geos = [];
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2 + this.R(-0.04, 0.04);
      const r = this.R(940, 1420), h = this.R(170, 420), rad = this.R(150, 290);
      const g = new THREE.ConeGeometry(rad, h, 14, 4).toNonIndexed();
      const pos = g.attributes.position;
      for (let k = 0; k < pos.count; k++) {
        const vx = pos.getX(k), vy = pos.getY(k), vz = pos.getZ(k);
        if (vy < h * 0.46) {
          const ang = Math.atan2(vx, vz);
          const ridge = 1 + 0.18 * Math.sin(ang * 5 + i) + 0.09 * Math.cos(ang * 9 - i * 2);
          pos.setXYZ(k, vx * ridge, vy, vz * ridge);
        }
      }
      g.computeVertexNormals();
      g.translate(Math.cos(a) * r, h / 2 - 8, Math.sin(a) * r);
      const baseC = new THREE.Color(this.P(['#6d8089', '#637682', '#75868b', '#5e707c']));
      const snowC = new THREE.Color('#eef4f8');
      const arr = new Float32Array(pos.count * 3);
      for (let k = 0; k < pos.count; k++) {
        const wy = pos.getY(k);
        const tSnow = clamp((wy - h * 0.56) / (h * 0.22), 0, 1);
        const cc = baseC.clone().lerp(snowC, tSnow);
        arr[k * 3] = cc.r; arr[k * 3 + 1] = cc.g; arr[k * 3 + 2] = cc.b;
      }
      g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
      geos.push(g);
    }
    const mtn = new THREE.Mesh(
      mergeGeometries(geos),
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true })
    );
    this.group.add(mtn);

    // Nuvens cumulus orgânicas (estilo anime / RAoT)
    const canopyGeo = getBlenderGeo('foliage_cluster');
    const cg = [];
    for (let i = 0; i < 42; i++) {
      const x = this.R(-1150, 1150), z = this.R(-1150, 1150), y = this.R(205, 300);
      const n = 2 + (this.rng() * 3 | 0);
      for (let k = 0; k < n; k++) {
        const sx = this.R(45, 95), sy = this.R(16, 30), sz = this.R(38, 78);
        const px = x + this.R(-38, 38), py = y + this.R(-5, 9), pz = z + this.R(-32, 32);
        if (canopyGeo) {
          cg.push(toMergeable(canopyGeo, [px, py, pz], this.R(0, 6.28), [sx, sy, sz], '#ffffff', 0));
        } else {
          cg.push(normalizeStdGeo(coloredBox(sx, sy, sz, '#ffffff', px, py, pz, 0, 0.01)));
        }
      }
    }
    this.clouds = new THREE.Mesh(
      mergeGeometries(cg, false),
      new THREE.MeshLambertMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.88,
        emissive: '#7c8ea0',
        emissiveIntensity: 0.55,
      })
    );
    this.scene.add(this.clouds);

    // Céu atmosférico estilo RAoT com disco solar e halo Mie dourado
    const sunDir = new THREE.Vector3(-0.45, 0.72, 0.35).normalize();
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(2400, 40, 24),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {
          top: { value: new THREE.Color('#2d6db5') },
          mid: { value: new THREE.Color('#8bc0e8') },
          bot: { value: new THREE.Color('#e8ece6') },
          sunDir: { value: sunDir },
        },
        vertexShader: `
          varying vec3 vP;
          void main() {
            vP = normalize(position);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform vec3 top;
          uniform vec3 mid;
          uniform vec3 bot;
          uniform vec3 sunDir;
          varying vec3 vP;
          void main() {
            vec3 d = normalize(vP);
            float h = d.y;
            vec3 c = h > 0.0
              ? mix(mid, top, pow(smoothstep(0.0, 0.72, h), 0.85))
              : mix(mid, bot, smoothstep(0.0, -0.18, h));
            float sunAmt = max(dot(d, normalize(sunDir)), 0.0);
            // Halo atmosférico dourado + disco solar nítido
            c += vec3(1.0, 0.86, 0.62) * pow(sunAmt, 10.0) * 0.28;
            c += vec3(1.0, 0.96, 0.86) * smoothstep(0.9982, 0.9995, sunAmt) * 1.35;
            gl_FragColor = vec4(c, 1.0);
          }
        `,
      })
    );
    this.sky = sky;
    this.scene.add(sky);
  }

  update(dt, camPos) {
    if (this.clouds) {
      this.clouds.position.x += dt * 2.4;
      if (this.clouds.position.x > 500) this.clouds.position.x = -500;
    }
    if (this.sky) this.sky.position.copy(camPos);
    const t = performance.now() * 0.001;
    for (const d of this.depots) d.beam.material.opacity = 0.20 + Math.sin(t * 2) * 0.06;
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

  collideSphere(pos, vel, r, info) {
    info.onGround = false; info.impact = 0; info.hit = false;
    info.normal.set(0, 0, 0);
    for (let iter = 0; iter < 2; iter++) {
      if (pos.y < r) {
        pos.y = r;
        if (vel.y < 0) { info.impact = Math.max(info.impact, -vel.y); vel.y = 0; }
        info.onGround = true; info.hit = true; info.normal.set(0, 1, 0);
      }
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

  raycast(o, d, maxT) {
    let bestT = maxT, found = false;
    const bestN = new THREE.Vector3();
    const n = new THREE.Vector3();
    for (const c of this.colliders) {
      const t = rayAABB(o, d, c.min, c.max, bestT, n);
      if (t >= 0 && t < bestT) { bestT = t; bestN.copy(n); found = true; }
    }
    if (d.y < -1e-6) {
      const t = -o.y / d.y;
      if (t > 0 && t < bestT) { bestT = t; bestN.set(0, 1, 0); found = true; }
    }
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
        test(t1, true, sign); test(t2, true, sign);
      }
    }
    if (Math.abs(d.y) > 1e-6) test((H - o.y) / d.y, false, 1);
    return best;
  }

  isInside(x, z) { return Math.hypot(x, z) < CFG.WALL_R; }
}
