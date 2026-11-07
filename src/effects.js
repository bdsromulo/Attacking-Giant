import * as THREE from 'three';
import { rand, clamp } from './util.js';
import { getSoftPuffTexture } from './textures.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _qRoll = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _u = new THREE.Vector3();
const _v = new THREE.Vector3();
const _e = new THREE.Euler();
const _c = new THREE.Color();
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const UP_AXIS = new THREE.Vector3(0, 1, 0);

function makeRibbonEdgeTexture() {
  if (typeof document === 'undefined') {
    const dt = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    dt.needsUpdate = true;
    return dt;
  }
  const c = document.createElement('canvas');
  c.width = 32;
  c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 0, 64);
  grd.addColorStop(0.0, 'rgba(255,255,255,0.0)');
  grd.addColorStop(0.22, 'rgba(255,255,255,0.75)');
  grd.addColorStop(0.5, 'rgba(255,255,255,1.0)');
  grd.addColorStop(0.78, 'rgba(255,255,255,0.75)');
  grd.addColorStop(1.0, 'rgba(255,255,255,0.0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 32, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Pool de partículas 3D sólidas / faíscas / traçantes (suporta alongamento por velocidade).
class CubePool {
  constructor(scene, max, material, geo = null) {
    this.max = max;
    this.mesh = new THREE.InstancedMesh(geo || new THREE.IcosahedronGeometry(0.52, 1), material, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    scene.add(this.mesh);
    this.p = [];
  }
  spawn(o) {
    if (this.p.length >= this.max) this.p.shift();
    this.p.push({
      pos: o.pos.clone(), vel: o.vel ? o.vel.clone() : new THREE.Vector3(),
      life: o.life ?? 1, max: o.life ?? 1, size: o.size ?? 0.3, grow: o.grow ?? 0,
      grav: o.grav ?? 0, drag: o.drag ?? 0, color: new THREE.Color(o.color ?? '#ffffff'),
      rot: new THREE.Vector3(rand(0, 6), rand(0, 6), rand(0, 6)), spin: o.spin ?? 2,
      floor: o.floor ?? true, stretch: o.stretch ?? 0,
    });
  }
  update(dt) {
    let n = 0;
    const list = this.p;
    for (let i = list.length - 1; i >= 0; i--) {
      const q = list[i];
      q.life -= dt;
      if (q.life <= 0) { list.splice(i, 1); continue; }
      q.vel.y -= q.grav * dt;
      if (q.drag) q.vel.multiplyScalar(Math.max(0, 1 - q.drag * dt));
      q.pos.addScaledVector(q.vel, dt);
      if (q.floor && q.pos.y < q.size * 0.5) {
        q.pos.y = q.size * 0.5;
        q.vel.y *= -0.22;
        q.vel.x *= 0.7;
        q.vel.z *= 0.7;
      }
      q.rot.x += q.spin * dt;
      q.rot.y += q.spin * dt * 0.7;
    }
    for (const q of list) {
      if (n >= this.max) break;
      const t = q.life / q.max;
      const sz = Math.max(0.001, (q.size + q.grow * (1 - t)) * Math.min(1, t * 3));
      const sp = q.stretch > 0 ? q.vel.length() : 0;
      if (sp > 0.5) {
        _u.copy(q.vel).divideScalar(sp);
        _q.setFromUnitVectors(UP_AXIS, _u);
        _s.set(sz * 0.65, sz * (1 + Math.min(14, sp * q.stretch)), sz * 0.65);
      } else {
        _e.set(q.rot.x, q.rot.y, q.rot.z);
        _q.setFromEuler(_e);
        _s.set(sz, sz, sz);
      }
      _m.compose(q.pos, _q, _s);
      this.mesh.setMatrixAt(n, _m);
      this.mesh.setColorAt(n, q.color);
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
  clear() { this.p.length = 0; this.mesh.count = 0; }
}

// Pool de sprites volumétricos macios orientados para a câmera (vapor de Titã, gás ODM, poeira).
class BillboardPuffPool {
  constructor(scene, max) {
    this.max = max;
    const mat = new THREE.MeshBasicMaterial({
      map: getSoftPuffTexture(),
      color: '#ffffff',
      transparent: true,
      opacity: 0.44,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1.35, 1.35), mat, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.mesh.count = 0;
    scene.add(this.mesh);
    this.p = [];
  }
  spawn(o) {
    if (this.p.length >= this.max) this.p.shift();
    this.p.push({
      pos: o.pos.clone(), vel: o.vel ? o.vel.clone() : new THREE.Vector3(),
      life: o.life ?? 1, max: o.life ?? 1, size: o.size ?? 0.4, grow: o.grow ?? 0,
      grav: o.grav ?? 0, drag: o.drag ?? 0, color: new THREE.Color(o.color ?? '#ffffff'),
      roll: rand(0, Math.PI * 2), spin: (o.spin ?? 1.1) * (Math.random() < 0.5 ? -1 : 1),
      floor: o.floor ?? false,
    });
  }
  update(dt, camera) {
    let n = 0;
    const list = this.p;
    for (let i = list.length - 1; i >= 0; i--) {
      const q = list[i];
      q.life -= dt;
      if (q.life <= 0) { list.splice(i, 1); continue; }
      q.vel.y -= q.grav * dt;
      if (q.drag) q.vel.multiplyScalar(Math.max(0, 1 - q.drag * dt));
      q.pos.addScaledVector(q.vel, dt);
      if (q.floor && q.pos.y < q.size * 0.35) {
        q.pos.y = q.size * 0.35;
        q.vel.y = Math.abs(q.vel.y) * 0.1;
      }
      q.roll += q.spin * dt;
    }
    const camPos = camera ? camera.position : null;
    const camQuat = camera ? camera.quaternion : null;
    for (const q of list) {
      if (n >= this.max) break;
      const t = clamp(q.life / q.max, 0, 1);
      // Curva suave de entrada e dissipação (evita pop abrupto)
      const env = Math.sin(Math.pow(t, 0.72) * Math.PI);
      let nearFade = 1;
      if (camPos) {
        const d2 = q.pos.distanceToSquared(camPos);
        if (d2 < 6.25) nearFade = clamp((Math.sqrt(d2) - 0.85) / 1.65, 0, 1);
      }
      const sz = Math.max(0.001, (q.size + q.grow * (1 - t)) * (0.35 + 0.65 * env) * nearFade);
      if (camQuat) {
        _qRoll.setFromAxisAngle(Z_AXIS, q.roll);
        _q.copy(camQuat).multiply(_qRoll);
      } else {
        _q.identity();
      }
      _s.set(sz, sz, sz);
      _m.compose(q.pos, _q, _s);
      this.mesh.setMatrixAt(n, _m);
      this.mesh.setColorAt(n, q.color);
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
  clear() { this.p.length = 0; this.mesh.count = 0; }
}

// Fita 3D contínua (usada para o rastro de gás ODM e arcos das lâminas no estilo RAoT).
class RibbonTrail {
  constructor(scene, maxNodes, opts = {}) {
    this.maxNodes = maxNodes;
    this.nodes = [];
    this.segId = 1;
    this.active = false;
    this.color = new THREE.Color(opts.color || '#f4fbff');
    const maxVerts = maxNodes * 2;
    this.posArr = new Float32Array(maxVerts * 3);
    this.uvArr = new Float32Array(maxVerts * 2);
    this.colArr = new Float32Array(maxVerts * 4);
    const indices = [];
    for (let i = 0; i < maxNodes - 1; i++) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      indices.push(a, b, c, b, d, c);
    }
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.posArr, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('uv', new THREE.BufferAttribute(this.uvArr, 2).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.colArr, 4).setUsage(THREE.DynamicDrawUsage));
    this.geo.setIndex(indices);
    this.geo.setDrawRange(0, 0);

    this.mat = new THREE.MeshBasicMaterial({
      map: opts.edgeMap || null,
      vertexColors: true,
      transparent: true,
      opacity: opts.opacity ?? 0.55,
      blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    scene.add(this.mesh);
  }

  breakSegment() {
    if (this.active) {
      this.active = false;
      this.segId++;
    }
  }

  pushEdge(pA, pB, maxAge = 0.22) {
    this.active = true;
    const n = this.nodes;
    if (n.length > 0) {
      const last = n[n.length - 1];
      if (last.seg === this.segId && last.a.distanceToSquared(pA) < 0.0025 && last.b.distanceToSquared(pB) < 0.0025) {
        return;
      }
    }
    if (n.length >= this.maxNodes) n.shift();
    n.push({ a: pA.clone(), b: pB.clone(), age: 0, maxAge, seg: this.segId });
  }

  pushCenter(center, halfAxis, maxAge = 0.42, grow = 0.35) {
    this.active = true;
    const n = this.nodes;
    if (n.length > 0) {
      const last = n[n.length - 1];
      if (last.seg === this.segId && last.c && last.c.distanceToSquared(center) < 0.03) {
        return;
      }
    }
    if (n.length >= this.maxNodes) n.shift();
    n.push({
      c: center.clone(),
      axis: halfAxis.clone(),
      a: center.clone().add(halfAxis),
      b: center.clone().sub(halfAxis),
      grow,
      age: 0,
      maxAge,
      seg: this.segId,
    });
  }

  update(dt, camera) {
    const n = this.nodes;
    for (let i = n.length - 1; i >= 0; i--) {
      n[i].age += dt;
      if (n[i].age >= n[i].maxAge) n.splice(i, 1);
    }
    if (n.length < 2) {
      this.geo.setDrawRange(0, 0);
      return;
    }

    const camPos = camera ? camera.position : null;
    for (let i = 0; i < n.length; i++) {
      const node = n[i];
      const u = clamp(1 - node.age / node.maxAge, 0, 1);
      if (node.c) {
        // Billboarding da fita de gás em torno da tangente para nunca ficar invisível de perfil
        const prev = n[Math.max(0, i - 1)];
        const next = n[Math.min(n.length - 1, i + 1)];
        const tan = _u.copy(next.c || next.a).sub(prev.c || prev.a);
        if (tan.lengthSq() < 1e-5) tan.set(0, 0, 1); else tan.normalize();
        if (camPos) {
          _v.copy(camPos).sub(node.c).cross(tan);
          if (_v.lengthSq() < 1e-5) _v.copy(node.axis); else _v.normalize();
        } else {
          _v.copy(node.axis).normalize();
        }
        const halfW = (0.065 + (1 - u) * node.grow) * Math.min(1, u * 4.5);
        node.a.copy(node.c).addScaledVector(_v, halfW);
        node.b.copy(node.c).addScaledVector(_v, -halfW);
      }

      const v0 = i * 2;
      const p3 = v0 * 3;
      this.posArr[p3] = node.a.x; this.posArr[p3 + 1] = node.a.y; this.posArr[p3 + 2] = node.a.z;
      this.posArr[p3 + 3] = node.b.x; this.posArr[p3 + 4] = node.b.y; this.posArr[p3 + 5] = node.b.z;

      const u2 = v0 * 2;
      const sCoord = i / (n.length - 1);
      this.uvArr[u2] = sCoord; this.uvArr[u2 + 1] = 0;
      this.uvArr[u2 + 2] = sCoord; this.uvArr[u2 + 3] = 1;

      // Quebra invisível entre segmentos separados (evita polígono esticado ao religar o gás)
      const segBreak = (i > 0 && n[i - 1].seg !== node.seg) || (i < n.length - 1 && n[i + 1].seg !== node.seg);
      let nearFade = 1;
      if (camPos && node.c) {
        const d2 = node.c.distanceToSquared(camPos);
        if (d2 < 4.0) nearFade = clamp((Math.sqrt(d2) - 0.7) / 1.3, 0, 1);
      }
      const alpha = segBreak ? 0 : Math.pow(u, 1.35) * nearFade;
      const c4 = v0 * 4;
      this.colArr[c4] = this.color.r;
      this.colArr[c4 + 1] = this.color.g;
      this.colArr[c4 + 2] = this.color.b;
      this.colArr[c4 + 3] = alpha;
      this.colArr[c4 + 4] = this.color.r;
      this.colArr[c4 + 5] = this.color.g;
      this.colArr[c4 + 6] = this.color.b;
      this.colArr[c4 + 7] = alpha;
    }

    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.uv.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
    this.geo.setDrawRange(0, (n.length - 1) * 6);
  }

  clear() {
    this.nodes.length = 0;
    this.active = false;
    this.segId++;
    this.geo.setDrawRange(0, 0);
  }
}

export class Effects {
  constructor(scene) {
    this.scene = scene;
    const edgeMap = makeRibbonEdgeTexture();
    this.solid = new CubePool(scene, 1400, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.55, metalness: 0.05 }));
    this.steam = new BillboardPuffPool(scene, 1800);
    this.glow = new CubePool(
      scene,
      450,
      new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.92, blending: THREE.AdditiveBlending, depthWrite: false }),
      new THREE.OctahedronGeometry(0.45, 0),
    );
    this.gasRibbon = new RibbonTrail(scene, 48, { color: '#f2f9ff', opacity: 0.46, additive: false, edgeMap });
    this.bladeRibbons = [
      new RibbonTrail(scene, 24, { color: '#dceeff', opacity: 0.72, additive: true, edgeMap }),
      new RibbonTrail(scene, 24, { color: '#dceeff', opacity: 0.72, additive: true, edgeMap }),
    ];
    this.debris = [];
    this.arcs = [];
    this.arcGeo = new THREE.RingGeometry(1.45, 2.28, 32, 1, -1.05, 2.1);
    this.shake = 0;
  }

  puff(pos, vel, color = '#eef4f8', size = 0.35, life = 0.55) {
    this.steam.spawn({ pos, vel, size, grow: size * 2.1, life, drag: 2.6, color, floor: false });
  }

  gasJet(pos, dir, strength = 1) {
    for (let i = 0; i < 2; i++) {
      _p.copy(dir).multiplyScalar(-rand(5, 11) * strength).add(new THREE.Vector3(rand(-0.7, 0.7), rand(-0.7, 0.7), rand(-0.7, 0.7)));
      this.puff(pos, _p, '#f4f9fd', rand(0.14, 0.26), rand(0.28, 0.48));
    }
  }

  updatePlayerTrails(nozzlePos, camRight, gasOn, bladeBases, bladeTips, bladesActive) {
    if (gasOn && nozzlePos) {
      _u.copy(camRight).multiplyScalar(0.08);
      this.gasRibbon.pushCenter(nozzlePos, _u, 0.42, 0.34);
    } else {
      this.gasRibbon.breakSegment();
    }

    if (bladesActive && bladeBases && bladeTips) {
      for (let i = 0; i < 2; i++) {
        const b = bladeBases[i].getWorldPosition(_p);
        const t = bladeTips[i].getWorldPosition(_u);
        this.bladeRibbons[i].pushEdge(b, t, 0.16);
      }
    } else {
      this.bladeRibbons[0].breakSegment();
      this.bladeRibbons[1].breakSegment();
    }
  }

  landingRing(pos, power = 0.7) {
    const count = Math.round(8 + power * 10);
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + rand(-0.15, 0.15);
      const sp = (2.6 + power * 4.5) * rand(0.75, 1.2);
      const sz = rand(0.20, 0.34) * (0.8 + power * 0.3);
      const p = new THREE.Vector3(pos.x + Math.cos(a) * 0.28, pos.y + sz * 0.85 + 0.18, pos.z + Math.sin(a) * 0.28);
      const v = new THREE.Vector3(Math.cos(a) * sp, rand(0.55, 1.35), Math.sin(a) * sp);
      this.steam.spawn({ pos: p, vel: v, size: sz, grow: 0.55 + power * 0.35, life: rand(0.30, 0.52), drag: 4.0, color: '#dfd5c3', floor: false });
    }
    if (power > 0.8) {
      this.sparks(new THREE.Vector3(pos.x, pos.y + 0.16, pos.z), 6);
    }
  }

  blood(pos, dir, amount = 20, scale = 1) {
    for (let i = 0; i < amount; i++) {
      const v = new THREE.Vector3(rand(-1, 1), rand(-0.2, 1.2), rand(-1, 1)).multiplyScalar(rand(4, 12) * scale);
      if (dir) v.addScaledVector(dir, rand(3, 10));
      this.solid.spawn({ pos, vel: v, size: rand(0.11, 0.32) * scale, life: rand(0.6, 1.35), grav: 22, stretch: 0.06, color: _c.setHSL(0, rand(0.74, 0.92), rand(0.24, 0.38)).getStyle() });
    }
    for (let i = 0; i < amount / 2; i++) {
      this.steam.spawn({ pos, vel: new THREE.Vector3(rand(-2, 2), rand(1, 4), rand(-2, 2)), size: rand(0.45, 0.95) * scale, grow: 1.5 * scale, life: rand(0.75, 1.5), drag: 1.6, color: '#f2deda', floor: false });
    }
  }

  sparks(pos, amount = 10) {
    for (let i = 0; i < amount; i++) {
      this.glow.spawn({
        pos,
        vel: new THREE.Vector3(rand(-1, 1), rand(-0.4, 1.1), rand(-1, 1)).multiplyScalar(rand(7, 16)),
        size: rand(0.045, 0.10),
        life: rand(0.18, 0.42),
        grav: 20,
        stretch: 0.22,
        color: i % 3 === 0 ? '#fff6d6' : '#ffd27a',
      });
    }
  }

  dust(pos, radius = 4, amount = 24) {
    for (let i = 0; i < amount; i++) {
      const a = rand(0, Math.PI * 2), r = rand(0, radius);
      const sz = rand(0.42, 0.95);
      const p = new THREE.Vector3(pos.x + Math.cos(a) * r, pos.y + sz * 0.75 + 0.22, pos.z + Math.sin(a) * r);
      this.steam.spawn({ pos: p, vel: new THREE.Vector3(Math.cos(a) * rand(1.8, 6.2), rand(0.6, 2.5), Math.sin(a) * rand(1.8, 6.2)), size: sz, grow: 1.45, life: rand(0.7, 1.45), drag: 1.8, color: '#d4c7b0', floor: false });
    }
  }

  bigSteam(pos, scale = 1, amount = 6) {
    for (let i = 0; i < amount; i++) {
      this.steam.spawn({
        pos: new THREE.Vector3(pos.x + rand(-0.9, 0.9) * scale, pos.y + rand(-0.4, 0.5) * scale, pos.z + rand(-0.9, 0.9) * scale),
        vel: new THREE.Vector3(rand(-1, 1), rand(2.2, 6.2), rand(-1, 1)).multiplyScalar(scale * 0.5),
        size: rand(0.65, 1.45) * scale,
        grow: 2.1 * scale,
        life: rand(1.1, 2.3),
        drag: 0.85,
        color: '#f8f5f0',
        floor: false,
      });
    }
  }

  speedStreak(pos, vel) {
    this.glow.spawn({
      pos,
      vel: vel.clone().multiplyScalar(-0.32),
      size: 0.032,
      life: 0.18,
      stretch: 0.55,
      color: '#e8f4ff',
      floor: false,
    });
  }

  slashArc(pos, quat, scale = 1, color = '#e8f5ff') {
    const m = new THREE.Mesh(this.arcGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.88, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
    m.position.copy(pos);
    m.quaternion.copy(quat);
    m.scale.setScalar(scale);
    this.scene.add(m);
    this.arcs.push({ m, life: 0.18, max: 0.18 });
  }

  // Pedaço de gigante cortado: clona malhas com transformação de mundo.
  addDebris(sourceGroup, vel, scale = 1) {
    const g = new THREE.Group();
    sourceGroup.updateWorldMatrix(true, true);
    sourceGroup.traverse((o) => {
      if (!o.isMesh) return;
      const c = new THREE.Mesh(o.geometry, o.material);
      o.matrixWorld.decompose(c.position, c.quaternion, c.scale);
      c.castShadow = true;
      g.add(c);
    });
    const box = new THREE.Box3().setFromObject(g);
    const center = box.getCenter(new THREE.Vector3());
    g.children.forEach((c) => c.position.sub(center));
    g.position.copy(center);
    this.scene.add(g);
    this.debris.push({ g, vel: vel.clone(), ang: new THREE.Vector3(rand(-2, 2), rand(-2, 2), rand(-2, 2)), life: 6, scale, half: (box.max.y - box.min.y) * 0.25 });
  }

  update(dt, camera = null) {
    this.solid.update(dt);
    this.steam.update(dt, camera);
    this.glow.update(dt);
    this.gasRibbon.update(dt, camera);
    this.bladeRibbons[0].update(dt, camera);
    this.bladeRibbons[1].update(dt, camera);
    for (let i = this.arcs.length - 1; i >= 0; i--) {
      const a = this.arcs[i];
      a.life -= dt;
      a.m.material.opacity = Math.max(0, a.life / a.max) * 0.88;
      a.m.scale.multiplyScalar(1 + dt * 2.2);
      if (a.life <= 0) { this.scene.remove(a.m); a.m.material.dispose(); this.arcs.splice(i, 1); }
    }
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      d.life -= dt;
      if (d.g.position.y > d.half) {
        d.vel.y -= 20 * dt;
        d.g.position.addScaledVector(d.vel, dt);
        d.g.rotation.x += d.ang.x * dt;
        d.g.rotation.z += d.ang.z * dt;
      } else {
        d.g.position.y = d.half;
        d.vel.set(0, 0, 0);
      }
      if (Math.random() < dt * 6) this.bigSteam(d.g.position, d.scale * 0.8, 1);
      if (d.life < 1.5) d.g.scale.setScalar(Math.max(0.01, d.life / 1.5));
      if (d.life <= 0) { this.scene.remove(d.g); this.debris.splice(i, 1); }
    }
    this.shake = Math.max(0, this.shake - dt * 3);
  }

  addShake(a) { this.shake = Math.min(1.5, this.shake + a); }

  clear() {
    this.solid.clear();
    this.steam.clear();
    this.glow.clear();
    this.gasRibbon.clear();
    this.bladeRibbons[0].clear();
    this.bladeRibbons[1].clear();
    for (const d of this.debris) this.scene.remove(d.g);
    for (const a of this.arcs) this.scene.remove(a.m);
    this.debris.length = 0;
    this.arcs.length = 0;
  }
}
