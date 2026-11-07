import * as THREE from 'three';
import { CFG } from './config.js';
import { buildGiantModel } from './models.js';
import { rand, clamp, angleDiff, damp, pick } from './util.js';

export const GIANT_TYPES = {
  comum:    { name: 'Comum',    h: [9, 13],  speed: 3.4, nape: 140, limb: 70,  turn: 1.6, reach: 1.0, grabTime: 1.0, score: 100 },
  pequeno:  { name: 'Pequeno',  h: [6, 8],   speed: 4.2, nape: 90,  limb: 50,  turn: 2.2, reach: 1.0, grabTime: 0.85, score: 70 },
  errante:  { name: 'Errante',  h: [10, 14], speed: 9.5, nape: 170, limb: 80,  turn: 3.0, reach: 1.15, grabTime: 0.6, score: 200, erratic: true, leap: true },
  blindado: { name: 'Blindado', h: [13, 15], speed: 3.0, nape: 200, limb: 120, turn: 1.2, reach: 1.0, grabTime: 1.0, score: 300, armored: true, armorHP: 260 },
  colosso:  { name: 'Colosso',  h: [30, 34], speed: 2.4, nape: 380, limb: 200, turn: 0.6, reach: 0.9, grabTime: 1.4, score: 1000, boss: true },
  boneco:   { name: 'Boneco',   h: [10, 12], speed: 0,   nape: 100, limb: 60,  turn: 0,   reach: 0,   grabTime: 9, score: 50, dummy: true },
};

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _inv = new THREE.Matrix4();
const DOWN = new THREE.Vector3(0, -1, 0);

let NEXT_ID = 1;

export class Giant {
  constructor(typeKey, x, z, scene) {
    this.id = NEXT_ID++;
    this.typeKey = typeKey;
    this.T = GIANT_TYPES[typeKey];
    this.H = rand(this.T.h[0], this.T.h[1]);
    this.s = this.H / 10;
    this.m = buildGiantModel({ armored: this.T.armored, boss: this.T.boss, dummy: this.T.dummy, fat: this.T.boss ? 1.2 : undefined });
    this.root = this.m.root;
    this.root.scale.setScalar(this.s);
    this.root.position.set(x, 0, z);
    this.heading = rand(0, Math.PI * 2);
    this.root.rotation.y = this.heading;
    scene.add(this.root);
    this.scene = scene;
    this.pos = this.root.position;
    this.vel = new THREE.Vector3();
    this.state = this.T.dummy ? 'idle' : 'wander';
    this.alive = true;
    this.napeHP = this.T.nape;
    this.armorHP = this.T.armorHP || 0;
    this.phase = rand(0, 6);
    this.lastStepSign = 1;
    this.grabCD = rand(1, 3);
    this.leapCD = rand(3, 6);
    this.steamCD = 6;
    this.steamCharge = 0;
    this.wanderT = 0;
    this.wanderTarget = new THREE.Vector3(x, 0, z);
    this.limbs = {
      armL: { sev: false, t: 0, group: this.m.arms.L.shoulder },
      armR: { sev: false, t: 0, group: this.m.arms.R.shoulder },
      legL: { sev: false, t: 0, group: this.m.legs.L.knee },
      legR: { sev: false, t: 0, group: this.m.legs.R.knee },
      eyes: { sev: false, t: 0, group: this.m.eyes },
    };
    this.downed = 0;       // 0..1 pose de queda/ajoelhado
    this.blind = 0;
    this.grab = null;      // {side, t, dur, caught}
    this.deathT = 0;
    this.airborne = false;
    this.lookYaw = 0; this.lookPitch = 0;
    this.speedMul = 1;
    this.erraticT = 0; this.erraticOff = 0;
    this.flash = 0;
    this.stunT = 0;
    this.zoneMeshes = this.m.meshes.filter((mm) => mm.userData.zone !== 'body');
    this.zones = {
      armL: this.zoneMeshes.filter((mm) => mm.userData.zone === 'armL'),
      armR: this.zoneMeshes.filter((mm) => mm.userData.zone === 'armR'),
      legL: this.zoneMeshes.filter((mm) => mm.userData.zone === 'legL'),
      legR: this.zoneMeshes.filter((mm) => mm.userData.zone === 'legR'),
    };
    if (this.T.armored) this.m.armor[0].userData.isArmor = true;
    for (const mm of this.m.meshes) mm.userData.giant = this;
  }

  get radius() { return 1.6 * this.s; }

  isVisible(mesh) {
    let o = mesh;
    while (o) { if (!o.visible) return false; if (o === this.root) return true; o = o.parent; }
    return true;
  }

  limbKeyOf(zone) { return zone; }

  // ===== dano =====
  receiveHit(zone, dmg, mesh, ctx) {
    if (!this.alive) return { r: 'nothing' };
    const { effects, audio } = ctx;
    const hitPos = mesh.getWorldPosition(new THREE.Vector3());
    this.flash = 0.15;
    if (zone === 'nape') {
      if (this.armorHP > 0) {
        this.armorHP -= dmg;
        effects.sparks(hitPos, 18);
        audio.clang();
        if (this.armorHP <= 0) {
          const plate = this.m.armor[0];
          effects.addDebris(plate, new THREE.Vector3(0, 4, 0), this.s);
          plate.visible = false;
          plate.userData.zone = 'body';
          this.zoneMeshes = this.zoneMeshes.filter((z) => z !== plate);
          return { r: 'armorbreak', dmg };
        }
        return { r: 'armor', dmg };
      }
      if (dmg >= this.napeHP) {
        effects.blood(hitPos, null, 40, this.s * 0.7);
        this.kill(ctx);
        return { r: 'kill', dmg };
      }
      this.napeHP -= dmg * 0.4;
      effects.blood(hitPos, null, 10, this.s * 0.5);
      return { r: 'weak', dmg, need: Math.ceil(this.napeHP) };
    }
    if (zone === 'eyes') {
      if (dmg >= 50 && !this.limbs.eyes.sev) {
        this.limbs.eyes.sev = true; this.limbs.eyes.t = 9;
        this.blind = 1;
        effects.blood(hitPos, null, 16, this.s * 0.5);
        audio.roar(this.s, 0.6);
        return { r: 'blind', dmg };
      }
      return { r: 'nothing', dmg };
    }
    if (this.limbs[zone]) {
      const L = this.limbs[zone];
      if (L.sev) return { r: 'nothing' };
      if (dmg >= this.T.limb) {
        this.sever(zone, ctx);
        return { r: 'sever', dmg, limb: zone };
      }
      effects.blood(hitPos, null, 8, this.s * 0.4);
      return { r: 'weaklimb', dmg };
    }
    return { r: 'nothing' };
  }

  sever(zone, ctx) {
    const L = this.limbs[zone];
    if (L.sev) return;
    L.sev = true;
    L.t = zone.startsWith('leg') ? 11 : 14;
    const p = L.group.getWorldPosition(new THREE.Vector3());
    ctx.effects.addDebris(L.group, new THREE.Vector3(rand(-3, 3), 2, rand(-3, 3)), this.s);
    ctx.effects.blood(p, null, 30, this.s * 0.6);
    L.group.visible = false;
    if (this.grab && zone === 'arm' + this.grab.side) this.releaseGrab(ctx, true);
    ctx.audio.roar(this.s, 0.5);
  }

  kill(ctx) {
    if (!this.alive) return;
    this.alive = false;
    this.state = 'dying';
    this.deathT = 0;
    if (this.grab) this.releaseGrab(ctx, true);
    this.fallDir = Math.random() < 0.5 ? 1 : -1;
    ctx.audio.roar(this.s, 1.0);
  }

  releaseGrab(ctx, free) {
    if (!this.grab) return;
    const g = this.grab;
    this.grab = null;
    this.grabCD = 4;
    if (g.caught && ctx.player.grabbedBy === this) ctx.player.releaseFromGrab(free);
  }

  // ===== IA =====
  computeTarget(player, world) {
    const pIn = world.isInside(player.pos.x, player.pos.z);
    const gIn = world.isInside(this.pos.x, this.pos.z);
    if (pIn === gIn) return player.pos;
    const R = CFG.WALL_R, ang = Math.atan2(this.pos.z, this.pos.x);
    const nearBreach = Math.abs(angleDiff(ang, CFG.BREACH_ANGLE)) < CFG.BREACH_HALF * 1.3 && Math.abs(Math.hypot(this.pos.x, this.pos.z) - R) < 26;
    const a = CFG.BREACH_ANGLE;
    const r = nearBreach ? (pIn ? R - 30 : R + 30) : (gIn ? R - 30 : R + 30);
    return _v2.set(Math.cos(a) * r, 0, Math.sin(a) * r);
  }

  update(dt, ctx) {
    const { player, world, effects, audio } = ctx;
    this.flash = Math.max(0, this.flash - dt);
    this.updateLimbs(dt, ctx);

    if (this.state === 'dying' || this.state === 'dead') { this.updateDeath(dt, ctx); return; }

    const legsOut = this.limbs.legL.sev || this.limbs.legR.sev;
    this.downed = damp(this.downed, legsOut ? 1 : 0, 3, dt);
    this.blind = this.limbs.eyes.sev ? 1 : damp(this.blind, 0, 2, dt);

    const toP = _v.copy(player.pos).sub(this.pos); toP.y = 0;
    const distP = toP.length();
    let moveSpeed = 0;
    let desired = this.heading;

    if (this.T.dummy) {
      this.animate(dt, 0, ctx);
      return;
    }

    // estado
    if (player.alive && !this.grab) {
      const aggro = this.alwaysChase ? 1e9 : (this.T.boss ? 160 : 95);
      if (this.state === 'wander' && distP < aggro && !this.limbs.eyes.sev) this.state = 'chase';
      if (this.state === 'chase' && ((!this.alwaysChase && distP > 180) || this.limbs.eyes.sev)) this.state = 'wander';
    }
    if (!player.alive && this.state === 'chase') this.state = 'wander';

    if (this.state === 'wander') {
      this.wanderT -= dt;
      if (this.wanderT <= 0 || this.pos.distanceTo(this.wanderTarget) < 5) {
        this.wanderT = rand(5, 12);
        const a = rand(0, Math.PI * 2), r = rand(10, 50);
        this.wanderTarget.set(this.pos.x + Math.cos(a) * r, 0, this.pos.z + Math.sin(a) * r);
      }
      const d = _v2.copy(this.wanderTarget).sub(this.pos);
      desired = Math.atan2(d.x, d.z);
      moveSpeed = this.T.speed * 0.45;
    } else if (this.state === 'chase') {
      const tgt = this.computeTarget(player, world);
      const d = _v2.copy(tgt).sub(this.pos); d.y = 0;
      desired = Math.atan2(d.x, d.z);
      moveSpeed = this.T.speed;
      if (this.T.erratic) {
        this.erraticT -= dt;
        if (this.erraticT <= 0) { this.erraticT = rand(0.6, 2); this.erraticOff = rand(-1.1, 1.1); }
        desired += this.erraticOff * Math.min(1, distP / 30);
      }
      // ataque: agarrar
      this.grabCD -= dt;
      const reach = (2.4 + 2.2 + 1.2) * this.s * this.T.reach + 1.85 * this.s;
      const pyRel = player.pos.y;
      if (!this.grab && this.grabCD <= 0 && distP < reach && pyRel < this.H * 1.15 && player.alive && !player.grabbedBy) {
        const local = this.root.worldToLocal(_v2.copy(player.pos));
        const side = local.x >= 0 ? 'L' : 'R';
        const alt = side === 'L' ? 'R' : 'L';
        const useSide = !this.limbs['arm' + side].sev ? side : (!this.limbs['arm' + alt].sev ? alt : null);
        if (useSide && local.z > -this.s * 2) {
          this.grab = { side: useSide, t: 0, dur: this.T.grabTime, caught: false, hold: 0 };
          audio.growl(this.s);
        }
      }
      // salto do Errante
      if (this.T.leap && !this.airborne && !legsOut) {
        this.leapCD -= dt;
        if (this.leapCD <= 0 && distP > 16 && distP < 55 && player.pos.y < this.H * 1.5) {
          this.leapCD = rand(5, 9);
          const flight = 1.3;
          this.vel.set(toP.x / flight, 0.5 * CFG.gravity * flight * 0.9, toP.z / flight);
          this.airborne = true;
          audio.roar(this.s, 0.35);
        }
      }
      // explosão de vapor do Colosso
      if (this.T.boss) {
        this.steamCD -= dt;
        const close = player.pos.distanceTo(this.m.neck.getWorldPosition(_v2)) < this.H * 0.9;
        if (this.steamCharge > 0) {
          this.steamCharge -= dt;
          effects.bigSteam(this.m.spine.getWorldPosition(_v2).add(new THREE.Vector3(rand(-1, 1) * this.s * 2, rand(0, 4) * this.s, rand(-1, 1) * this.s * 2)), this.s * 0.6, 2);
          if (this.steamCharge <= 0) this.steamBlast(ctx);
        } else if (this.steamCD <= 0 && close) {
          this.steamCharge = 1.6; this.steamCD = rand(9, 13);
          audio.hiss(1.6);
        }
      }
    }

    this.stunT = Math.max(0, this.stunT - dt);
    if (this.stunT > 0) { moveSpeed = 0; if (this.grab && !this.grab.caught) this.grab = null; this.grabCD = Math.max(this.grabCD, 0.5); }
    if (this.grab) moveSpeed *= 0.15;
    if (this.limbs.eyes.sev) moveSpeed *= 0.15;
    moveSpeed *= 1 - this.downed * 0.8;

    // desvio de obstáculos e de outros gigantes
    const fx = Math.sin(desired), fz = Math.cos(desired);
    let ax = fx, az = fz;
    const rad = this.radius;
    if (moveSpeed > 0) {
      for (const c of world.queryRadius(this.pos.x, this.pos.z, rad + 6)) {
        if (c.max.y < this.H * 0.25 || c.tag === 'roof') continue;
        const cx = clamp(this.pos.x, c.min.x, c.max.x), cz = clamp(this.pos.z, c.min.z, c.max.z);
        let dx = this.pos.x - cx, dz = this.pos.z - cz;
        const d = Math.hypot(dx, dz) || 0.01;
        const w = clamp((rad + 6 - d) / (rad + 6), 0, 1) * 1.8;
        ax += (dx / d) * w; az += (dz / d) * w;
      }
      for (const o of ctx.giants) {
        if (o === this || !o.alive) continue;
        const dx = this.pos.x - o.pos.x, dz = this.pos.z - o.pos.z;
        const d = Math.hypot(dx, dz) || 0.01, min = rad + o.radius + 2;
        if (d < min) { ax += (dx / d) * (min - d) / min * 2; az += (dz / d) * (min - d) / min * 2; }
      }
    }
    const steer = Math.atan2(ax, az);
    const turnRate = this.T.turn * (this.state === 'chase' ? 1 : 0.6);
    this.heading += clamp(angleDiff(steer, this.heading), -turnRate * dt, turnRate * dt);
    this.root.rotation.y = this.heading;

    if (this.airborne) {
      this.vel.y -= CFG.gravity * 0.9 * dt;
      this.pos.addScaledVector(this.vel, dt);
      if (this.pos.y <= 0) {
        this.pos.y = 0; this.airborne = false; this.vel.set(0, 0, 0);
        this.landShock(ctx, 7 * this.s, 30);
      }
    } else {
      const sp = moveSpeed * this.speedMul;
      this.pos.x += Math.sin(this.heading) * sp * dt;
      this.pos.z += Math.cos(this.heading) * sp * dt;
    }
    this.blockWall();

    this.animate(dt, moveSpeed, ctx);
    this.updateGrab(dt, ctx);
  }

  blockWall() {
    const R = CFG.WALL_R, T = CFG.WALL_T + this.radius * 2;
    const rr = Math.hypot(this.pos.x, this.pos.z);
    if (Math.abs(rr - R) < T / 2) {
      const ang = Math.atan2(this.pos.z, this.pos.x);
      if (Math.abs(angleDiff(ang, CFG.BREACH_ANGLE)) > CFG.BREACH_HALF * 0.85) {
        const nr = rr < R ? R - T / 2 : R + T / 2;
        this.pos.x *= nr / rr; this.pos.z *= nr / rr;
      }
    }
  }

  landShock(ctx, radius, dmg) {
    const { player, effects, audio } = ctx;
    effects.dust(this.pos, radius, 40);
    audio.thud(1, this.s);
    const d = player.pos.distanceTo(this.pos);
    effects.addShake(clamp(1.2 - d / 80, 0, 1));
    if (d < radius && player.pos.y < 4 * this.s && player.alive) {
      player.damage(dmg, 'shock');
      const push = _v.copy(player.pos).sub(this.pos).setY(0).normalize().multiplyScalar(18);
      push.y = 10;
      player.vel.add(push);
    }
  }

  steamBlast(ctx) {
    const { player, effects, audio } = ctx;
    const c = this.m.spine.getWorldPosition(new THREE.Vector3());
    for (let i = 0; i < 40; i++) effects.bigSteam(c.clone().add(new THREE.Vector3(rand(-1, 1), rand(-0.5, 1.5), rand(-1, 1)).multiplyScalar(this.s * 3)), this.s * 0.8, 1);
    audio.hiss(0.6, 1.4);
    const d = player.pos.distanceTo(c);
    if (d < this.H * 1.0 && player.alive) {
      const push = _v.copy(player.pos).sub(c).normalize().multiplyScalar(38);
      player.vel.add(push);
      player.damage(8, 'steam');
      player.detachAll();
    }
  }

  animate(dt, speed, ctx) {
    const m = this.m;
    const legSc = this.s;
    const moving = speed > 0.1 || this.airborne;
    const rate = this.T.erratic ? 1.35 : 1;
    this.phase += dt * (moving ? speed / (1.25 * legSc) * rate + 0.2 : 0.4);
    const sw = Math.sin(this.phase);
    const amp = this.T.erratic ? 0.75 : 0.5;
    const k = moving ? 1 : 0.08;
    const down = this.downed;
    // pernas
    for (const [side, sgn] of [['L', 1], ['R', -1]]) {
      const leg = m.legs[side];
      const s2 = sw * sgn;
      leg.hip.rotation.x = -s2 * amp * k * (1 - down) - down * 1.3;
      leg.knee.rotation.x = Math.max(0, Math.cos(this.phase + (sgn > 0 ? 0 : Math.PI))) * 0.7 * k * (1 - down) + down * 1.6;
    }
    // passos -> tremor
    const sign = sw >= 0 ? 1 : -1;
    if (moving && sign !== this.lastStepSign && !this.airborne && down < 0.5) {
      const d = ctx.player.pos.distanceTo(this.pos);
      ctx.audio.footstep(d, this.s);
      ctx.effects.addShake(clamp((this.s * 0.25) - d / 160, 0, 0.35));
    }
    this.lastStepSign = sign;
    // corpo
    m.body.position.y = m.hipH - Math.abs(Math.cos(this.phase)) * 0.18 * k - down * m.hipH * 0.55;
    m.body.rotation.x = down * 0.85 + (this.T.erratic && moving ? 0.25 : 0);
    m.spine.rotation.z = Math.sin(this.phase) * 0.05 * k;
    m.spine.rotation.y = Math.sin(this.phase) * 0.08 * k;
    // braços (se não agarrando)
    for (const [side, sgn] of [['L', 1], ['R', -1]]) {
      if (this.grab && this.grab.side === side) continue;
      const a = m.arms[side];
      const targetX = (this.blind > 0.5 || this.stunT > 0) ? -2.4 : (down > 0.5 ? -1.2 : sw * sgn * 0.4 * k);
      const flail = this.T.erratic && moving ? Math.sin(this.phase * 2 + sgn) * 0.6 : 0;
      a.shoulder.quaternion.setFromEuler(new THREE.Euler(targetX + flail * 0.5, 0, sgn * (0.12 + Math.abs(flail) * 0.4)));
      a.elbow.rotation.x = (this.blind > 0.5 || this.stunT > 0) ? -1.6 : -0.25 - (this.T.erratic ? 0.5 : 0);
    }
    // cabeça segue o jogador
    const toP = _v.copy(ctx.player.pos);
    const nw = m.neck.getWorldPosition(_v2);
    toP.sub(nw);
    const yawW = Math.atan2(toP.x, toP.z);
    const yaw = clamp(angleDiff(yawW, this.heading), -1.0, 1.0);
    const pitch = clamp(-Math.atan2(toP.y, Math.hypot(toP.x, toP.z)), -0.7, 0.6);
    const watching = this.state === 'chase' && this.blind < 0.5;
    this.lookYaw = damp(this.lookYaw, watching ? yaw : Math.sin(this.phase * 0.3) * 0.3, 4, dt);
    this.lookPitch = damp(this.lookPitch, watching ? pitch : 0, 4, dt);
    m.neck.rotation.y = this.lookYaw;
    m.neck.rotation.x = this.lookPitch - down * 0.5;
    // brilho ao levar dano
    m.skinMat.emissive.setRGB(this.flash * 2, this.flash * 0.4, this.flash * 0.3);
  }

  updateGrab(dt, ctx) {
    if (!this.grab) return;
    const g = this.grab, { player } = ctx;
    const arm = this.m.arms[g.side];
    g.t += dt;
    if (this.limbs['arm' + g.side].sev) { this.grab = null; return; }
    if (!g.caught) {
      // mira o braço no jogador
      const sh = arm.shoulder.getWorldPosition(_v);
      const dirW = _v2.copy(player.pos).sub(sh).normalize();
      // para o espaço local do pai do ombro
      const parentQ = arm.shoulder.parent.getWorldQuaternion(_q).invert();
      dirW.applyQuaternion(parentQ);
      const target = new THREE.Quaternion().setFromUnitVectors(DOWN, dirW);
      const k = Math.min(1, g.t / (g.dur * 0.7));
      arm.shoulder.quaternion.slerp(target, Math.min(1, dt * 10 * (0.3 + k)));
      arm.elbow.rotation.x = damp(arm.elbow.rotation.x, 0, 8, dt);
      if (g.t > g.dur * 0.65 && g.t < g.dur * 1.05) {
        const hand = arm.hand.getWorldPosition(_v);
        hand.y -= 0.6 * this.s;
        if (hand.distanceTo(player.pos) < 1.5 * this.s + 0.9 && player.alive && !player.grabbedBy && !player.invuln) {
          g.caught = true;
          player.grabbedBy = this;
          player.grabHand = arm.hand;
          player.onGrabbed();
          ctx.audio.growl(this.s * 1.3);
        }
      }
      if (g.t > g.dur * 1.4) { this.grab = null; this.grabCD = rand(2, 4); }
    } else {
      // levanta até a boca
      g.hold += dt;
      const mouth = this.m.head.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(Math.sin(this.heading), 0, Math.cos(this.heading)).multiplyScalar(2.2 * this.s));
      const sh = arm.shoulder.getWorldPosition(_v);
      const dirW = _v2.copy(mouth).sub(sh).normalize();
      const parentQ = arm.shoulder.parent.getWorldQuaternion(_q).invert();
      dirW.applyQuaternion(parentQ);
      const target = new THREE.Quaternion().setFromUnitVectors(DOWN, dirW);
      arm.shoulder.quaternion.slerp(target, Math.min(1, dt * 1.6));
      arm.elbow.rotation.x = damp(arm.elbow.rotation.x, -1.4 * Math.min(1, g.hold / 2.5), 3, dt);
      if (g.hold > 3.0 && player.grabbedBy === this) {
        player.eaten(this);
        this.grab = null; this.grabCD = 5;
        ctx.effects.blood(mouth, null, 50, 1);
      }
    }
  }

  updateLimbs(dt, ctx) {
    for (const key in this.limbs) {
      const L = this.limbs[key];
      if (!L.sev) continue;
      if (!this.alive) continue;
      L.t -= dt;
      if (Math.random() < dt * 5) ctx.effects.bigSteam(L.group.getWorldPosition(_v), this.s * 0.35, 1);
      if (L.t <= 0) {
        L.sev = false;
        L.group.visible = true;
        L.group.scale.setScalar(0.25);
        L.regrow = 1;
      }
    }
    for (const key in this.limbs) {
      const L = this.limbs[key];
      if (L.regrow) {
        L.regrow -= dt;
        L.group.scale.setScalar(1 - Math.max(0, L.regrow) * 0.75);
        if (L.regrow <= 0) { L.regrow = 0; L.group.scale.setScalar(1); }
      }
    }
  }

  updateDeath(dt, ctx) {
    this.deathT += dt;
    const m = this.m;
    if (this.state === 'dying') {
      const t = Math.min(1, this.deathT / 1.8);
      const e = t * t;
      m.body.rotation.x = (this.downed * 0.85) * (1 - e) + this.fallDir * 1.45 * e;
      m.body.position.y = m.hipH * (1 - this.downed * 0.55) * (1 - e) + 0.9 * e;
      for (const s of ['L', 'R']) {
        m.legs[s].hip.rotation.x = damp(m.legs[s].hip.rotation.x, this.fallDir > 0 ? -0.2 : 0.3, 3, dt);
        m.arms[s].shoulder.quaternion.slerp(new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.4 * this.fallDir, 0, s === 'L' ? 0.9 : -0.9)), dt * 2);
      }
      m.neck.rotation.x = damp(m.neck.rotation.x, 0.4, 2, dt);
      if (t >= 1) {
        this.state = 'dead'; this.deathT = 0;
        ctx.effects.dust(this.pos, 6 * this.s, 50);
        ctx.audio.thud(1.3, this.s);
        const d = ctx.player.pos.distanceTo(this.pos);
        ctx.effects.addShake(clamp(1.0 - d / 100, 0, 0.9));
      }
    } else {
      if (Math.random() < dt * 14) {
        const p = m.spine.getWorldPosition(_v).add(new THREE.Vector3(rand(-1, 1) * this.s * 3, rand(-1, 1) * this.s, rand(-1, 1) * this.s * 3));
        ctx.effects.bigSteam(p, this.s * 0.6, 2);
      }
      const k = Math.max(0, 1 - this.deathT / 7);
      m.skinMat.color.multiplyScalar(1 - dt * 0.08);
      const ember = Math.max(0, Math.sin(Math.min(1, this.deathT / 5) * Math.PI)) * 0.35;
      m.skinMat.emissive.setRGB(ember * 1.4, ember * 0.35, ember * 0.1);
      if (this.deathT > 5) this.root.scale.setScalar(this.s * Math.max(0.01, k * 3.5));
    }
  }

  get removable() { return this.state === 'dead' && this.deathT > 7; }

  dispose() {
    this.scene.remove(this.root);
    this.root.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
    this.m.skinMat.dispose();
  }

  // Distância do ponto até a caixa (OBB) de uma malha.
  static meshDistance(mesh, p, out) {
    const gp = mesh.geometry.parameters;
    _inv.copy(mesh.matrixWorld).invert();
    const l = _v.copy(p).applyMatrix4(_inv);
    l.x = clamp(l.x, -gp.width / 2, gp.width / 2);
    l.y = clamp(l.y, -gp.height / 2, gp.height / 2);
    l.z = clamp(l.z, -gp.depth / 2, gp.depth / 2);
    l.applyMatrix4(mesh.matrixWorld);
    if (out) out.copy(l);
    return l.distanceTo(p);
  }
}

const ZONE_PRIORITY = { nape: 4, eyes: 3, legL: 2, legR: 2, armL: 1, armR: 1 };

export class GiantManager {
  constructor(scene) {
    this.scene = scene;
    this.giants = [];
    this.ray = new THREE.Raycaster();
  }

  spawn(type, x, z) {
    const g = new Giant(type, x, z, this.scene);
    this.giants.push(g);
    return g;
  }

  clear() { for (const g of this.giants) g.dispose(); this.giants.length = 0; }

  get aliveCount() { return this.giants.filter((g) => g.alive).length; }

  update(dt, ctx) {
    ctx.giants = this.giants;
    for (const g of this.giants) {
      g.update(dt, ctx);
      g.root.updateMatrixWorld(true);
    }
    for (let i = this.giants.length - 1; i >= 0; i--) {
      const g = this.giants[i];
      if (g.removable) {
        ctx.player.detachFromGiant(g);
        g.dispose();
        this.giants.splice(i, 1);
      }
    }
  }

  raycast(o, d, maxT) {
    let best = null;
    this.ray.set(o, d);
    this.ray.far = maxT;
    for (const g of this.giants) {
      if (g.state === 'dead' && g.deathT > 5) continue;
      // rejeição rápida: distância do raio ao centro
      const c = _v.copy(g.pos); c.y += g.H * 0.5;
      const toC = c.sub(o);
      const t = toC.dot(d);
      if (t < -g.H) continue;
      const perp = toC.addScaledVector(d, -t).length();
      if (perp > g.H * 0.9) continue;
      const hits = this.ray.intersectObjects(g.m.meshes, false);
      for (const h of hits) {
        if (!g.isVisible(h.object)) continue;
        if (!best || h.distance < best.t) best = { t: h.distance, point: h.point.clone(), mesh: h.object, giant: g, normal: h.face ? h.face.normal.clone().transformDirection(h.object.matrixWorld) : new THREE.Vector3(0, 1, 0) };
        break;
      }
    }
    return best;
  }

  // Procura a zona atingível mais prioritária dentro do alcance.
  slashQuery(pos, reach) {
    let best = null;
    for (const g of this.giants) {
      if (!g.alive) continue;
      if (Math.hypot(pos.x - g.pos.x, pos.z - g.pos.z) > g.H * 1.3 + reach) continue;
      for (const mesh of g.zoneMeshes) {
        if (!g.isVisible(mesh)) continue;
        const zone = mesh.userData.zone;
        const r = zone === 'nape' ? reach + 0.5 * g.s : reach;
        const d = Giant.meshDistance(mesh, pos);
        if (d > r) continue;
        const pr = ZONE_PRIORITY[zone] || 0;
        if (!best || pr > best.pr || (pr === best.pr && d < best.d)) best = { giant: g, mesh, zone, d, pr };
      }
    }
    return best;
  }

  // Alvo de lunge: ponto fraco mais alinhado com a mira.
  lungeTarget(pos, fwd, range, world, maxAngleDeg = 40) {
    let best = null;
    const cosMax = Math.cos((maxAngleDeg * Math.PI) / 180);
    for (const g of this.giants) {
      if (!g.alive) continue;
      if (Math.hypot(pos.x - g.pos.x, pos.z - g.pos.z) > range + g.H * 1.2) continue;
      for (const mesh of g.zoneMeshes) {
        const zone = mesh.userData.zone;
        if (zone === 'eyes' && mesh.geometry.parameters.width < 0.3) continue;
        if (!g.isVisible(mesh)) continue;
        const p = mesh.getWorldPosition(new THREE.Vector3());
        const to = p.clone().sub(pos);
        const d = to.length();
        if (d > range || d < 0.5) continue;
        to.divideScalar(d);
        const c = to.dot(fwd);
        if (c < cosMax) continue;
        const score = c + (zone === 'nape' ? 0.08 : 0) - d * 0.002;
        if (best && score <= best.score) continue;
        // linha de visão
        const hit = world.raycast(pos, to, d);
        if (hit && hit.t < d - 1) continue;
        best = { giant: g, mesh, zone, point: p, score, d };
      }
    }
    return best;
  }

  collidePlayer(pos, vel, r) {
    let touched = null;
    for (const g of this.giants) {
      if (g.state === 'dead' && g.deathT > 4) continue;
      if (Math.hypot(pos.x - g.pos.x, pos.z - g.pos.z) > g.H * 1.4) continue;
      // cápsula do tronco
      const a = g.m.body.getWorldPosition(new THREE.Vector3());
      const b = g.m.neck.getWorldPosition(new THREE.Vector3());
      const rad = 1.45 * g.s;
      const ab = b.clone().sub(a);
      const t = clamp(_v.copy(pos).sub(a).dot(ab) / ab.lengthSq(), 0, 1);
      const cp = a.addScaledVector(ab, t);
      const d = pos.distanceTo(cp);
      if (d < rad + r && d > 1e-4) {
        const n = _v.copy(pos).sub(cp).divideScalar(d);
        pos.addScaledVector(n, rad + r - d);
        const vn = vel.dot(n);
        if (vel.dot(n) < 0) vel.addScaledVector(n, -vn);
        touched = g;
      }
      // cabeça
      const h = g.m.head.getWorldPosition(new THREE.Vector3()); h.y += 1.0 * g.s;
      const hr = 1.15 * g.s;
      const dh = pos.distanceTo(h);
      if (dh < hr + r && dh > 1e-4) {
        const n = _v.copy(pos).sub(h).divideScalar(dh);
        pos.addScaledVector(n, hr + r - dh);
        const vn = vel.dot(n);
        if (vn < 0) vel.addScaledVector(n, -vn);
        touched = g;
      }
    }
    return touched;
  }
}

export function randomGiantType(wave) {
  const pool = ['comum', 'comum', 'comum', 'pequeno', 'pequeno'];
  if (wave >= 2) pool.push('errante');
  if (wave >= 3) pool.push('comum', 'errante');
  if (wave >= 4) pool.push('blindado');
  if (wave >= 6) pool.push('blindado', 'errante');
  return pick(pool);
}
