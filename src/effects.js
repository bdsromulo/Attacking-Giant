import * as THREE from 'three';
import { rand } from './util.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _e = new THREE.Euler();
const _c = new THREE.Color();

// Pool de partículas cúbicas (estética blocada) num InstancedMesh.
class CubePool {
  constructor(scene, max, material) {
    this.max = max;
    this.mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.58, 1), material, max);
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
      rot: new THREE.Vector3(rand(0, 6), rand(0, 6), rand(0, 6)), spin: o.spin ?? 2, floor: o.floor ?? true,
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
      if (q.floor && q.pos.y < q.size * 0.5) { q.pos.y = q.size * 0.5; q.vel.y *= -0.2; q.vel.x *= 0.7; q.vel.z *= 0.7; }
      q.rot.x += q.spin * dt; q.rot.y += q.spin * dt * 0.7;
    }
    for (const q of list) {
      if (n >= this.max) break;
      const t = q.life / q.max;
      const sz = Math.max(0.001, (q.size + q.grow * (1 - t)) * Math.min(1, t * 3));
      _e.set(q.rot.x, q.rot.y, q.rot.z);
      _q.setFromEuler(_e);
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

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.solid = new CubePool(scene, 1400, new THREE.MeshLambertMaterial({ color: '#ffffff' }));
    this.steam = new CubePool(scene, 1600, new THREE.MeshLambertMaterial({ color: '#ffffff', transparent: true, opacity: 0.38, depthWrite: false, emissive: '#9a9a9a' }));
    this.glow = new CubePool(scene, 300, new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.debris = [];
    this.arcs = [];
    this.arcGeo = new THREE.RingGeometry(1.4, 2.2, 24, 1, -0.9, 1.8);
    this.shake = 0;
  }

  puff(pos, vel, color = '#e8ecef', size = 0.35, life = 0.6) {
    this.steam.spawn({ pos, vel, size, grow: size * 2.2, life, drag: 2.5, color, floor: false });
  }
  gasJet(pos, dir, strength = 1) {
    for (let i = 0; i < 2; i++) {
      _p.copy(dir).multiplyScalar(-rand(6, 12) * strength).add(new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)));
      this.puff(pos, _p, '#f2f4f6', rand(0.15, 0.3), rand(0.35, 0.6));
    }
  }
  blood(pos, dir, amount = 20, scale = 1) {
    for (let i = 0; i < amount; i++) {
      const v = new THREE.Vector3(rand(-1, 1), rand(-0.2, 1.2), rand(-1, 1)).multiplyScalar(rand(4, 12) * scale);
      if (dir) v.addScaledVector(dir, rand(3, 10));
      this.solid.spawn({ pos, vel: v, size: rand(0.12, 0.35) * scale, life: rand(0.6, 1.4), grav: 22, color: _c.setHSL(0, rand(0.7, 0.9), rand(0.28, 0.4)).getStyle() });
    }
    for (let i = 0; i < amount / 2; i++)
      this.steam.spawn({ pos, vel: new THREE.Vector3(rand(-2, 2), rand(1, 4), rand(-2, 2)), size: rand(0.4, 0.9) * scale, grow: 1.5 * scale, life: rand(0.8, 1.6), drag: 1.5, color: '#f4e4e0', floor: false });
  }
  sparks(pos, amount = 10) {
    for (let i = 0; i < amount; i++)
      this.glow.spawn({ pos, vel: new THREE.Vector3(rand(-1, 1), rand(-0.5, 1), rand(-1, 1)).multiplyScalar(rand(6, 14)), size: rand(0.05, 0.12), life: rand(0.2, 0.45), grav: 20, color: '#ffe6a0' });
  }
  dust(pos, radius = 4, amount = 30) {
    for (let i = 0; i < amount; i++) {
      const a = rand(0, Math.PI * 2), r = rand(0, radius);
      const p = new THREE.Vector3(pos.x + Math.cos(a) * r, 0.3, pos.z + Math.sin(a) * r);
      this.steam.spawn({ pos: p, vel: new THREE.Vector3(Math.cos(a) * rand(2, 8), rand(0.5, 3), Math.sin(a) * rand(2, 8)), size: rand(0.6, 1.6), grow: 2.5, life: rand(1, 2), drag: 1.2, color: '#c9bba0', floor: false });
    }
  }
  bigSteam(pos, scale = 1, amount = 6) {
    for (let i = 0; i < amount; i++)
      this.steam.spawn({ pos: new THREE.Vector3(pos.x + rand(-1, 1) * scale, pos.y + rand(-0.5, 0.5) * scale, pos.z + rand(-1, 1) * scale), vel: new THREE.Vector3(rand(-1, 1), rand(2, 6), rand(-1, 1)).multiplyScalar(scale * 0.5), size: rand(0.6, 1.4) * scale, grow: 2 * scale, life: rand(1.2, 2.4), drag: 0.8, color: '#f6f2ee', floor: false });
  }
  speedStreak(pos, vel) {
    this.glow.spawn({ pos, vel: vel.clone().multiplyScalar(-0.1), size: 0.04, life: 0.25, color: '#ffffff', floor: false });
  }

  slashArc(pos, quat, scale = 1, color = '#ffffff') {
    const m = new THREE.Mesh(this.arcGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
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
    // recentraliza no centro aproximado
    const box = new THREE.Box3().setFromObject(g);
    const center = box.getCenter(new THREE.Vector3());
    g.children.forEach((c) => c.position.sub(center));
    g.position.copy(center);
    this.scene.add(g);
    this.debris.push({ g, vel: vel.clone(), ang: new THREE.Vector3(rand(-2, 2), rand(-2, 2), rand(-2, 2)), life: 6, scale, half: (box.max.y - box.min.y) * 0.25 });
  }

  update(dt) {
    this.solid.update(dt); this.steam.update(dt); this.glow.update(dt);
    for (let i = this.arcs.length - 1; i >= 0; i--) {
      const a = this.arcs[i];
      a.life -= dt;
      a.m.material.opacity = Math.max(0, a.life / a.max) * 0.85;
      a.m.scale.multiplyScalar(1 + dt * 2);
      if (a.life <= 0) { this.scene.remove(a.m); a.m.material.dispose(); this.arcs.splice(i, 1); }
    }
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      d.life -= dt;
      if (d.g.position.y > d.half) {
        d.vel.y -= 20 * dt;
        d.g.position.addScaledVector(d.vel, dt);
        d.g.rotation.x += d.ang.x * dt; d.g.rotation.z += d.ang.z * dt;
      } else { d.g.position.y = d.half; d.vel.set(0, 0, 0); }
      if (Math.random() < dt * 6) this.bigSteam(d.g.position, d.scale * 0.8, 1);
      if (d.life < 1.5) d.g.scale.setScalar(Math.max(0.01, d.life / 1.5));
      if (d.life <= 0) { this.scene.remove(d.g); this.debris.splice(i, 1); }
    }
    this.shake = Math.max(0, this.shake - dt * 3);
  }

  addShake(a) { this.shake = Math.min(1.5, this.shake + a); }

  clear() {
    this.solid.clear(); this.steam.clear(); this.glow.clear();
    for (const d of this.debris) this.scene.remove(d.g);
    for (const a of this.arcs) this.scene.remove(a.m);
    this.debris.length = 0; this.arcs.length = 0;
  }
}
