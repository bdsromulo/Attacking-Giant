import * as THREE from 'three';
import { CFG } from './config.js';
import { buildPlayerModel } from './models.js';
import { Giant } from './giants.js';
import { clamp, damp, rand } from './util.js';

const UP = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _d = new THREE.Vector3();
const _e = new THREE.Vector3();

const ropeGeoShared = new THREE.CylinderGeometry(0.028, 0.028, 1, 5, 1, true).translate(0, 0.5, 0);
const ropeMatShared = new THREE.MeshBasicMaterial({ color: '#2b2b2e' });

class Hook {
  constructor(scene, side) {
    this.side = side; // 1 = esquerdo, -1 = direito
    this.state = 'idle';
    this.tip = new THREE.Vector3();
    this.target = new THREE.Vector3();
    this.anchor = new THREE.Vector3();
    this.local = new THREE.Vector3();
    this.mesh = null;
    this.giant = null;
    this.hit = false;
    this.retargeted = false;
    this.len = 0;
    this.wraps = []; // RAoT PhysicalCable: vértices de dobra em quinas [{ point, normal, segLen }]
    this.rope = new THREE.Mesh(ropeGeoShared, ropeMatShared);
    this.rope.visible = false;
    this.rope.frustumCulled = false;
    this.wrapRopes = [];
    for (let i = 0; i < CFG.cableMaxWraps; i++) {
      const wr = new THREE.Mesh(ropeGeoShared, ropeMatShared);
      wr.visible = false;
      wr.frustumCulled = false;
      scene.add(wr);
      this.wrapRopes.push(wr);
    }
    this.head = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.3), new THREE.MeshLambertMaterial({ color: '#8d959c' }));
    this.head.visible = false;
    scene.add(this.rope, this.head);
  }
  get attached() { return this.state === 'attached'; }
  currentAnchor(out) {
    if (this.mesh) return this.mesh.localToWorld(out.copy(this.local));
    return out.copy(this.target);
  }
  // Pivô ativo do cabo (última quina dobrada ou a âncora final)
  pivotAnchor(out) {
    if (this.wraps.length > 0) return out.copy(this.wraps[this.wraps.length - 1].point);
    return this.currentAnchor(out);
  }
  clearWraps() {
    this.wraps.length = 0;
    for (const wr of this.wrapRopes) wr.visible = false;
  }
}

export const WEAPON_NAMES = {
  swords: 'LÂMINAS ODM',
  apg: 'PISTOLAS APG',
  spears: 'LANÇAS DO TROVÃO',
};

export const EMOTES = [
  { id: 'salute', name: 'ENTREGAR O CORAÇÃO!' },
  { id: 'wave', name: 'ACENAR' },
  { id: 'victory', name: 'VITÓRIA!' },
  { id: 'inspect', name: 'INSPECIONAR ARMA' },
];

export class Player {
  constructor(game) {
    this.game = game;
    const { scene } = game;
    this.scene = scene;
    this.pos = new THREE.Vector3(0, 2, 0);
    this.vel = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0;
    this.camFwd = new THREE.Vector3(0, 0, -1);
    this.camRight = new THREE.Vector3(1, 0, 0);
    this.hooks = [new Hook(scene, 1), new Hook(scene, -1)];
    this.info = { onGround: false, impact: 0, hit: false, normal: new THREE.Vector3() };
    this.skin = 'vanguarda';
    this.weapon = 'swords'; // 'swords' | 'apg' | 'spears'
    this.firstPerson = false;
    this.projectiles = []; // lâminas arremessadas e lanças do trovão ativas
    this.buildModel();
    this.camDist = 5.5;
    this.fov = 75;
    this.reelJerk = 0;
    this.resetStats();
    this.reset(new THREE.Vector3(0, 2, 30));
  }

  buildModel() {
    if (this.model) this.scene.remove(this.model.group);
    this.model = buildPlayerModel(this.skin);
    this.model.group.scale.setScalar(0.9);
    this.scene.add(this.model.group);
  }

  setSkin(k) { this.skin = k; this.buildModel(); }

  setWeapon(w) {
    if (!WEAPON_NAMES[w] || this.weapon === w) return;
    this.weapon = w;
    this.poised = false;
    this.reloadT = 0;
    if (this.game.hud) {
      this.game.hud.lastSets = -1;
      this.game.hud.flashMsg(`EQUIPAMENTO: ${WEAPON_NAMES[w]}`, '#ffd27a', 1.2);
    }
    this.game.audio.unsheath(true);
  }

  resetStats() {
    this.st = {
      gasMax: CFG.gasMax, reelSpeed: CFG.reelSpeed, reelAccel: CFG.reelAccel, burstSpeed: CFG.burstSpeed,
      hookRange: CFG.hookRange, dmgMul: 1, wearMul: 1, lungeRange: CFG.lungeRange, stressRecover: CFG.stressRecover,
      hpMax: 100, gasRegen: 0, bulletTime: false, bladeSetsMax: CFG.bladeSets, gasCostMul: 1,
    };
  }

  clearProjectiles() {
    for (const p of this.projectiles) this.scene.remove(p.mesh);
    this.projectiles.length = 0;
  }

  reset(spawn) {
    this.pos.copy(spawn);
    this.vel.set(0, 0, 0);
    this.hp = this.st.hpMax;
    this.gas = this.st.gasMax;
    this.blades = CFG.bladeDurability;
    this.bladeSets = this.st.bladeSetsMax;
    // munição APG e Lanças do Trovão
    this.apgLoaded = [true, true];
    this.apgPacks = CFG.apgPacks;
    this.spearLoaded = [true, true];
    this.spearAmmo = CFG.spearMaxAmmo;
    this.clearProjectiles();

    this.stress = 0; this.stressed = false; this.stressDelay = 0;
    this.alive = true;
    this.onGround = false;
    this.grabbedBy = null; this.grabHand = null; this.escape = 0;
    this.invuln = 0;
    this.lmbHeld = false; this.poised = false; this.poiseCD = 0;
    this.rollCD = 0; this.rollT = 0; this.slideT = 0;
    this.emoteT = 0; this.emoteIdx = 0;
    this.flareCD = 0; this.flares = { smoke: 3, acoustic: 2 };
    this.resupActive = false;
    this.slashT = 0; this.slashCD = 0; this.slashHitDone = true;
    this.spinT = 0;
    this.lastAtkPress = [-10, -10];
    this.lunge = null; this.lungeTarget = null;
    this.burst = null; this.queuedBurst = null; this.lastBurstEnd = -10; this.burstChain = 0;
    this.reloadT = 0;
    this.resupT = 0; this.inDepot = null;
    this.lastDamageT = 0;
    this.time = 0;
    this.reelJerk = 0;
    this.anim = { run: 0, slashSide: 1, slashK: 0 };
    for (const h of this.hooks) this.retract(h, true);
  }

  get speed() { return this.vel.length(); }
  get hookedCount() { return (this.hooks[0].attached ? 1 : 0) + (this.hooks[1].attached ? 1 : 0); }
  // RAoT: slowdown de recarga (10%) e overstress (15%) não acumulam, prevalece o mais forte
  get stressMul() {
    const s = this.stressed ? CFG.stressSlow : 1;
    const r = this.reloadT > 0 ? CFG.reloadSlow : 1;
    return Math.min(s, r);
  }

  // ================= ENTRADA =================
  // Layout de comandos no estilo do RAoT (ver DEFAULT_KEYS em main.js); implementação própria.
  handleInput(dt) {
    const I = this.game.input;
    const sens = this.game.settings.sens * 0.0022;
    this.yaw -= I.mouse.dx * sens;
    this.pitch -= I.mouse.dy * sens * (this.game.settings.invertY ? -1 : 1);
    this.pitch = clamp(this.pitch, -1.45, 1.45);
    const cp = Math.cos(this.pitch);
    this.camFwd.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
    this.camRight.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

    if (!this.alive) return;
    const K = this.game.settings.keys;
    if (this.grabbedBy) {
      if (I.pressed(K.hookL) || I.pressed(K.hookR) || I.pressed(K.ready)) this.struggle();
      return;
    }
    this.poiseCD = Math.max(0, this.poiseCD - dt);
    this.rollCD = Math.max(0, this.rollCD - dt);
    this.flareCD = Math.max(0, this.flareCD - dt);
    this.emoteT = Math.max(0, this.emoteT - dt);

    // troca rápida de equipamento RAoT: 1 = Lâminas ODM, 2 = Pistolas APG, 3 = Lanças do Trovão
    if (I.pressed('Digit1')) this.setWeapon('swords');
    if (I.pressed('Digit2')) this.setWeapon('apg');
    if (I.pressed('Digit3')) this.setWeapon('spears');
    // câmera em 1ª pessoa (B ou F5, como no CameraController.IsFirstPerson do RAoT)
    if (I.pressed('KeyB') || I.pressed('F5')) {
      this.firstPerson = !this.firstPerson;
      this.game.hud.flashMsg(this.firstPerson ? 'CÂMERA: 1ª PESSOA' : 'CÂMERA: 3ª PESSOA', '#cfe3ee', 0.9);
    }

    // postura (Ready Attack): alterna entre modo gancho e modo ataque
    if (I.pressed(K.ready) && this.poiseCD <= 0 && this.reloadT <= 0) {
      this.poised = !this.poised;
      this.game.audio.unsheath(this.poised);
    }

    // botões do mouse: gancho (normal) ou ataque (em postura)
    const pL = I.pressed(K.hookL), pR = I.pressed(K.hookR);
    if (this.poised && (pL || pR)) {
      if (pL) this.lastAtkPress[0] = this.time;
      if (pR) this.lastAtkPress[1] = this.time;
      const both = (pL && pR) || (pL && Math.abs(this.time - this.lastAtkPress[1]) < 0.09) || (pR && Math.abs(this.time - this.lastAtkPress[0]) < 0.09);
      if (both) this.attack(2); // ataque duplo (Spin / Double Shot / Double Spear)
      else if (pL) this.attack(0);
      else if (pR) this.attack(1);
    } else {
      for (const [i, code] of [[0, K.hookL], [1, K.hookR]]) {
        if (I.pressed(code)) this.fire(this.hooks[i]);
        if (I.released(code)) this.retract(this.hooks[i]);
      }
    }

    if (I.pressed(K.reload)) this.startReload();
    if (I.pressed(K.interact)) this.tryResupply();
    if (I.pressed(K.smoke)) this.fireFlare('smoke');
    if (I.pressed(K.acoustic)) this.fireFlare('acoustic');
    if (I.pressed(K.emote)) {
      this.emoteIdx = (this.emoteT > 0 ? (this.emoteIdx + 1) : this.emoteIdx) % EMOTES.length;
      this.emoteT = 1.8;
      this.game.hud.flashMsg(EMOTES[this.emoteIdx].name, '#ffd27a', 1.0);
    }

    // pulo (subir no chão — funciona também deslizando, como no patch 2.043 do RAoT) e rolamento
    if (I.pressed(K.up) && this.onGround && this.hookedCount === 0) {
      this.vel.y = CFG.jumpSpeed;
      this.onGround = false;
      this.slideT = 0;
    }
    if (I.pressed(K.down) && this.onGround && this.rollCD <= 0) this.startRoll();

    // burst: toque duplo em W/A/S/D/E/Q no ar (6 direções como no BurstManager do RAoT + fila queuedBurst)
    let tapped = null;
    for (const code of [K.fwd, K.back, K.left, K.right, K.up, K.down]) {
      if (I.doubleTap(code)) tapped = code;
    }
    if (tapped && !this.onGround && !this.lunge && this.gas > 0) {
      if (tapped === K.down && this.pos.y < CFG.downBurstMinY) tapped = null;
      if (tapped) {
        if (this.burst) this.queuedBurst = tapped; // RAoT BurstManager.queuedBurst
        else this.startBurst(tapped);
      }
    }
    if (this.burst) {
      this.burst.minT -= dt;
      if (!I.down(this.burst.key) && this.burst.minT <= 0) {
        this.endBurst();
        if (this.queuedBurst && !this.onGround && !this.lunge && this.gas > 0) {
          const qb = this.queuedBurst;
          this.queuedBurst = null;
          this.startBurst(qb);
        }
      }
    }
    if (this.burst) this.burstDir(this.burst.key, this.burst.dir);
  }

  // Direção de um burst a partir da tecla segurada (6 direções do RAoT: Front, Back, Left, Right, Upward, Downward).
  burstDir(code, out) {
    const K = this.game.settings.keys;
    if (code === K.fwd) out.copy(this.camFwd);
    else if (code === K.back) out.copy(this.camFwd).negate();
    else if (code === K.right) out.copy(this.camRight);
    else if (code === K.left) out.copy(this.camRight).negate();
    else if (code === K.up) out.copy(UP);
    else if (code === K.down) out.copy(UP).negate();
    else out.copy(this.camFwd);

    // RAoT BurstManager.ModifyDirectionForHookedMotion: redireciona parte do burst na tangente do cabo
    if (this.hookedCount > 0) {
      const h = this.hooks[0].attached ? this.hooks[0] : this.hooks[1];
      const toAnchor = h.pivotAnchor(_e).sub(this.pos);
      const dist = toAnchor.length();
      if (dist > 0.5 && dist >= h.len - 1.5) {
        toAnchor.divideScalar(dist);
        const radial = out.dot(toAnchor);
        if (radial < 0) {
          out.addScaledVector(toAnchor, -radial * CFG.hookedBurstTangent).normalize();
        }
      }
    }
    return out;
  }

  // Direção desejada relativa à câmera. full3D usa o pitch da câmera para W/S.
  wishDir(out, full3D) {
    const I = this.game.input, K = this.game.settings.keys;
    out.set(0, 0, 0);
    const f = full3D ? this.camFwd : _a.set(this.camFwd.x, 0, this.camFwd.z).normalize();
    if (I.down(K.fwd)) out.add(f);
    if (I.down(K.back)) out.sub(f);
    if (I.down(K.right)) out.add(this.camRight);
    if (I.down(K.left)) out.sub(this.camRight);
    if (out.lengthSq() > 0) out.normalize();
    return out;
  }

  // ================= GANCHOS + AUTO-AIM + CABLE WRAPPING =================
  raycastHook(origin, dir, range, allowAssist = true) {
    const hw = this.game.world.raycast(origin, dir, range);
    const hg = this.game.giants.raycast(origin, dir, range);
    let hit = hw;
    if (hg && (!hw || hg.t < hw.t)) hit = hg;
    if (hit && hit.point.distanceTo(this.pos) <= this.st.hookRange) {
      return { ...hit, retargeted: false };
    }
    if (!allowAssist) return hit;

    // RAoT SphericalAutoAim: varre um pequeno cone ao redor da mira quando o raio central erra
    const upAxis = _d.copy(this.camRight).cross(dir).normalize();
    const maxRad = (CFG.autoAimConeDeg * Math.PI) / 180;
    let best = null, bestScore = Infinity;
    for (const ring of [0.5, 1.0]) {
      const ang = maxRad * ring;
      for (let k = 0; k < 8; k++) {
        const phi = (k / 8) * Math.PI * 2;
        const testDir = _e.copy(dir)
          .addScaledVector(this.camRight, Math.cos(phi) * Math.sin(ang))
          .addScaledVector(upAxis, Math.sin(phi) * Math.sin(ang))
          .normalize();
        const tw = this.game.world.raycast(origin, testDir, range);
        const tg = this.game.giants.raycast(origin, testDir, range);
        let th = tw;
        if (tg && (!tw || tg.t < tw.t)) th = tg;
        if (th) {
          const dist = th.point.distanceTo(this.pos);
          if (dist <= this.st.hookRange) {
            const score = ring * 25 + dist * (th.giant ? 0.65 : 1.0);
            if (score < bestScore) { bestScore = score; best = { ...th, retargeted: true }; }
          }
        }
      }
    }
    return best || hit;
  }

  fire(h) {
    if (!this.alive || this.grabbedBy) return;
    h.clearWraps();
    const cam = this.game.camera;
    // Split Hooks (Shift): abre os ganchos para os lados da mira; normal: convergem no centro
    const split = this.game.input.down(this.game.settings.keys.split);
    const dir = this.camFwd.clone().applyAxisAngle(UP, h.side * (split ? CFG.splitAngle : 0.012));
    const camToPlayer = cam.position.distanceTo(this.pos);
    const origin = cam.position.clone().addScaledVector(dir, Math.max(0, camToPlayer - 0.6));
    const range = this.st.hookRange + 2;
    const hit = this.raycastHook(origin, dir, range, true);
    h.mesh = null; h.giant = null; h.retargeted = false;
    if (hit && hit.point.distanceTo(this.pos) <= this.st.hookRange) {
      h.hit = true;
      h.retargeted = !!hit.retargeted;
      h.target.copy(hit.point);
      if (hit.mesh) { h.mesh = hit.mesh; h.giant = hit.giant; hit.mesh.worldToLocal(h.local.copy(hit.point)); }
    } else {
      h.hit = false;
      h.target.copy(origin).addScaledVector(dir, this.st.hookRange);
    }
    this.launcherPos(h, h.tip);
    h.state = 'flying';
    h.rope.visible = true; h.head.visible = true;
    this.game.audio.hookFire(h.side);
  }

  retract(h, instant = false) {
    if (h.state === 'idle') return;
    h.clearWraps();
    if (instant) { h.state = 'idle'; h.rope.visible = false; h.head.visible = false; h.mesh = null; h.giant = null; return; }
    if (h.state === 'attached' || h.state === 'flying') this.game.audio.hookRelease();
    h.state = 'retract';
    h.mesh = null; h.giant = null;
  }

  detachAll() { for (const h of this.hooks) this.retract(h); }
  detachFromGiant(g) { for (const h of this.hooks) if (h.giant === g) this.retract(h); }

  launcherPos(h, out) {
    const l = h.side > 0 ? this.model.launcherL : this.model.launcherR;
    return l.getWorldPosition(out);
  }

  updateHooks(dt) {
    for (const h of this.hooks) {
      if (h.state === 'idle') continue;
      if (h.giant && (!h.giant.isVisible(h.mesh) || (h.giant.state === 'dead' && h.giant.deathT > 5))) this.retract(h);
      if (h.state === 'flying') {
        const t = h.currentAnchor(_a);
        const to = _b.copy(t).sub(h.tip);
        const d = to.length();
        const step = CFG.hookFlySpeed * dt;
        if (d <= step) {
          h.tip.copy(t);
          if (h.hit) {
            h.state = 'attached';
            h.len = Math.max(CFG.hookMinLen, this.pos.distanceTo(t));
            this.reelJerk = Math.min(0.45, this.reelJerk + 0.18); // RAoT CameraController.reelJerkValue
            this.game.audio.hookHit(h.giant ? 'flesh' : 'stone');
            this.game.effects.sparks(t, h.giant ? 0 : 5);
            if (h.giant) this.game.effects.blood(t, null, 3, 0.4);
          } else h.state = 'retract';
        } else h.tip.addScaledVector(to, step / d);
      } else if (h.state === 'attached') {
        h.currentAnchor(h.tip);
        // RAoT PhysicalCable (Ravel / Unravel): dobra o cabo quando quinas de prédios bloqueiam a linha de visão
        if (!h.giant) this.updateCableWrapping(h);
      } else if (h.state === 'retract') {
        const l = this.launcherPos(h, _a);
        const to = _b.copy(l).sub(h.tip);
        const d = to.length();
        const step = CFG.hookFlySpeed * 1.6 * dt;
        if (d <= step) { h.state = 'idle'; h.rope.visible = false; h.head.visible = false; h.clearWraps(); }
        else h.tip.addScaledVector(to, step / d);
      }
    }
  }

  updateCableWrapping(h) {
    // 1. Unravel (desenrola a última quina se o jogador voltou para o lado aberto da face)
    if (h.wraps.length > 0) {
      const top = h.wraps[h.wraps.length - 1];
      const prev = h.wraps.length >= 2 ? h.wraps[h.wraps.length - 2].point : h.currentAnchor(_a);
      const toPlayer = _b.copy(this.pos).sub(top.point);
      if (toPlayer.dot(top.normal) > 0.08) {
        const toPrev = _c.copy(prev).sub(this.pos);
        const distPrev = toPrev.length();
        if (distPrev > 0.4) {
          toPrev.divideScalar(distPrev);
          const hit = this.game.world.raycast(this.pos, toPrev, distPrev - 0.35);
          if (!hit) {
            h.len += top.segLen;
            h.wraps.pop();
          }
        }
      }
    }
    // 2. Ravel (adiciona uma quina se o segmento jogador -> pivô colidir com um prédio/muralha)
    if (h.wraps.length < CFG.cableMaxWraps) {
      const pivot = h.pivotAnchor(_a);
      const dir = _b.copy(pivot).sub(this.pos);
      const dist = dir.length();
      if (dist > 1.8) {
        dir.divideScalar(dist);
        const origin = _c.copy(this.pos).addScaledVector(dir, 0.45);
        const hit = this.game.world.raycast(origin, dir, dist - 0.9);
        if (hit && hit.normal.y < 0.85) {
          const wrapPt = hit.point.clone().addScaledVector(hit.normal, CFG.cableJut);
          const segLen = wrapPt.distanceTo(pivot);
          if (segLen > 0.4 && wrapPt.distanceTo(this.pos) > 0.6) {
            h.wraps.push({ point: wrapPt, normal: hit.normal.clone(), segLen });
            h.len = Math.max(CFG.hookMinLen, h.len - segLen);
          }
        }
      }
    }
  }

  // ================= BURST / STRESS =================
  startBurst(key) {
    const gasCost = CFG.burstStartCost * this.st.gasCostMul;
    if (this.gas < gasCost) return;
    this.gas -= gasCost;
    const now = this.time;
    if (now - this.lastBurstEnd < CFG.stressChainWindow) this.burstChain++;
    else this.burstChain = 0;
    this.addStress(CFG.stressPerBurst * (0.4 + this.burstChain * 0.6));
    const K = this.game.settings.keys;
    let scale = 1;
    if (key === K.back) scale = CFG.backBurstScale;
    else if (key === K.up) scale = CFG.upBurstScale;
    else if (key === K.down) scale = CFG.downBurstScale;
    this.burst = { key, dir: this.burstDir(key, new THREE.Vector3()), minT: 0.22, scale };
    this.game.audio.burst();
    const n = this.model.nozzle.getWorldPosition(_c);
    for (let i = 0; i < 6; i++) this.game.effects.gasJet(n, this.burst.dir, 1.4);
  }
  endBurst() { if (this.burst) { this.burst = null; this.lastBurstEnd = this.time; } }

  addStress(v) {
    const wasStressed = this.stressed;
    this.stress = clamp(this.stress + v, 0, 100);
    if (this.stress >= 100) {
      this.stressed = true;
      this.stressDelay = CFG.overstressDelay; // RAoT MAXED_COOLDOWN_SECS = 2.0s
      if (!wasStressed) {
        this.game.audio.overstress();
        this.game.effects.addShake(0.25);
        this.game.hud.flashMsg('OVERSTRESS! EQUIPAMENTO SOBRECARREGADO', '#ff4ad0', 1.3);
      }
    } else {
      this.stressDelay = Math.max(this.stressDelay, CFG.stressDelay);
    }
  }

  // ================= COMBATE (LÂMINAS ODM / APG / LANÇAS DO TROVÃO) =================
  attack(side) {
    if (this.slashCD > 0 || this.reloadT > 0) return;
    const keepPoise = this.game.input.down(this.game.settings.keys.ready);

    if (this.weapon === 'apg') {
      this.fireApg(side);
      if (!keepPoise) { this.poised = false; this.poiseCD = 0.18; }
      return;
    }
    if (this.weapon === 'spears') {
      // Se há lanças ativas prontas para detonação manual, detona antes de disparar outra
      const readySpears = this.projectiles.filter((p) => p.kind === 'spear' && p.age > 0.2);
      if (readySpears.length > 0) {
        for (const s of readySpears) this.detonateSpear(s);
        return;
      }
      this.fireSpear(side);
      if (!keepPoise) { this.poised = false; this.poiseCD = 0.22; }
      return;
    }

    // Lâminas ODM:
    // side === 2 (LMB + RMB simultâneos): SwordSpinAttack (giro duplo 360°)
    if (side === 2) {
      this.startSpinSlash();
      if (!keepPoise) { this.poised = false; this.poiseCD = 0.22; }
      return;
    }
    // side === 1 (RMB em postura sem alvo de lunge ou segurando Shift): SwordThrowAttack (arremesso de lâminas!)
    if (side === 1 && (!this.lungeTarget || this.game.input.down(this.game.settings.keys.split))) {
      this.throwBlades();
      if (!keepPoise) { this.poised = false; this.poiseCD = 0.2; }
      return;
    }
    if (this.lungeTarget) {
      if (this.stressed) {
        this.game.hud.flashMsg('STRESS MÁXIMO — NÃO PODE DAR LUNGE!', '#ff4ad0', 0.9);
        this.startSlash(side);
        return;
      }
      this.startLunge(this.lungeTarget);
      // RAoT: lunge tira a postura exceto se o jogador mantiver F (ReadyAttack) segurado
      if (!keepPoise) {
        this.poised = false;
        this.poiseCD = 0.2;
      }
    } else this.startSlash(side);
  }

  startSlash(side = 0) {
    this.slashT = CFG.slashTime;
    this.slashCD = CFG.slashCooldown;
    this.slashHitDone = false;
    this.anim.slashSide = side === 0 ? 1 : -1;
    this.game.audio.slash();
    const p = this.pos.clone().addScaledVector(this.camFwd, 1.2);
    const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(new THREE.Vector3(), this.camFwd, UP));
    q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), this.anim.slashSide * 0.5));
    this.game.effects.slashArc(p, q, 1.0);
  }

  // RAoT SwordSpinAttack: ataque duplo giratório com ambas as lâminas
  startSpinSlash() {
    this.spinT = 0.36;
    this.slashT = CFG.slashTime * 1.25;
    this.slashCD = CFG.slashCooldown * 1.35;
    this.slashHitDone = true;
    this.addStress(18);
    this.game.audio.spinSlash();
    const p = this.pos.clone().addScaledVector(this.camFwd, 0.8);
    for (const tilt of [-0.35, 0.35]) {
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2 + tilt, this.yaw, 0, 'YXZ'));
      this.game.effects.slashArc(p, q, 1.45, '#e8f6ff');
    }
    const q = this.game.giants.slashQuery(this.pos, CFG.spinReach);
    if (q) this.doHit(q, CFG.spinDmgMul);
  }

  // RAoT SwordThrowAttack / BladeProjectile: arremessa o par de lâminas em linha balística
  throwBlades() {
    if (this.blades <= 0) {
      this.game.audio.clang();
      this.game.hud.flashMsg('SEM LÂMINAS PARA ARREMESSAR — [R]', '#ff8a6a');
      return;
    }
    const durRatio = clamp(this.blades / CFG.bladeDurability, 0.35, 1);
    this.blades = 0; // consome o par atual nas mãos
    this.slashCD = 0.35;
    this.slashT = CFG.slashTime * 0.8;
    this.slashHitDone = true;
    this.addStress(15);
    this.game.audio.bladeThrow();

    const m = new THREE.Group();
    const bMat = new THREE.MeshBasicMaterial({ color: '#eef6ff' });
    const b1 = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.12, 1.2), bMat);
    b1.position.x = -0.18;
    const b2 = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.12, 1.2), bMat);
    b2.position.x = 0.18;
    m.add(b1, b2);
    const start = this.pos.clone().add(new THREE.Vector3(0, 0.85, 0)).addScaledVector(this.camFwd, 0.9);
    m.position.copy(start);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), this.camFwd);
    this.scene.add(m);
    const vel = this.camFwd.clone().multiplyScalar(CFG.bladeThrowSpeed).addScaledVector(this.vel, 0.35);
    this.projectiles.push({ kind: 'blade', mesh: m, pos: start, vel, age: 0, maxAge: 2.2, durRatio });
  }

  // RAoT ApgGunShotSingleAttack / ApgGunShotDoubleAttack
  fireApg(side) {
    const isDouble = side === 2 || (this.apgLoaded[0] && this.apgLoaded[1] && this.game.input.down(this.game.settings.keys.split));
    if (isDouble) {
      if (!this.apgLoaded[0] && !this.apgLoaded[1]) {
        this.game.audio.clang();
        this.game.hud.flashMsg('APG DESCARREGADA — [R]', '#ff8a6a');
        return;
      }
      this.apgLoaded[0] = false; this.apgLoaded[1] = false;
    } else {
      const idx = side === 1 ? 1 : 0;
      if (!this.apgLoaded[idx]) {
        // se o outro cano tiver bala, usa ele; senão pede recarga
        const alt = 1 - idx;
        if (this.apgLoaded[alt]) this.apgLoaded[alt] = false;
        else {
          this.game.audio.clang();
          this.game.hud.flashMsg('APG DESCARREGADA — [R]', '#ff8a6a');
          return;
        }
      } else this.apgLoaded[idx] = false;
    }

    const doubleShot = isDouble;
    this.slashCD = doubleShot ? 0.42 : 0.24;
    this.slashT = 0.18;
    this.slashHitDone = true;
    this.addStress(doubleShot ? 28 : 14);
    this.game.audio.apgShot(doubleShot);
    this.game.effects.addShake(doubleShot ? 0.32 : 0.16);
    // recuo das pistolas APG no ar
    if (!this.onGround) this.vel.addScaledVector(this.camFwd, doubleShot ? -7.5 : -3.8);

    const muzzle = this.pos.clone().add(new THREE.Vector3(0, 0.85, 0)).addScaledVector(this.camFwd, 0.9);
    this.game.effects.sparks(muzzle, doubleShot ? 22 : 12);
    this.game.effects.puff(muzzle, this.camFwd.clone().multiplyScalar(8), '#e6e0d6', doubleShot ? 0.65 : 0.4, 0.45);

    const maxR = doubleShot ? CFG.apgDoubleRange : CFG.apgRange;
    // traçantes de chumbo (pellet cone)
    for (let i = 0; i < (doubleShot ? 14 : 8); i++) {
      const d = this.camFwd.clone().add(new THREE.Vector3(rand(-CFG.apgSpread, CFG.apgSpread), rand(-CFG.apgSpread, CFG.apgSpread), rand(-CFG.apgSpread, CFG.apgSpread))).normalize();
      this.game.effects.glow.spawn({ pos: muzzle.clone(), vel: d.multiplyScalar(95), size: 0.08, life: 0.18, color: '##ffe29a'.slice(1), floor: false });
    }

    // verifica acerto no cone frontal contra zonas dos gigantes
    let bestHit = null, bestScore = Infinity;
    const rg = this.game.giants.raycast(muzzle, this.camFwd, maxR);
    if (rg && rg.t <= maxR) {
      bestHit = { giant: rg.giant, mesh: rg.mesh, zone: rg.mesh.userData.zone || 'body', dist: rg.t, point: rg.point };
    } else {
      for (const g of this.game.giants.giants) {
        if (!g.alive) continue;
        for (const [zone, list] of [['nape', [g.m.nape]], ['eyes', g.m.eyes.children], ['armL', g.zones.armL], ['armR', g.zones.armR], ['legL', g.zones.legL], ['legR', g.zones.legR]]) {
          for (const m of list) {
            if (!g.isVisible(m)) continue;
            const wp = m.getWorldPosition(_a);
            const to = _b.copy(wp).sub(muzzle);
            const dist = to.length();
            if (dist > maxR) continue;
            const ang = to.divideScalar(dist).angleTo(this.camFwd);
            const maxAng = (doubleShot ? 0.24 : 0.16) + 1.4 / Math.max(3, dist);
            if (ang < maxAng) {
              const sc = ang * dist * (zone === 'nape' ? 0.5 : zone === 'eyes' ? 0.6 : 1);
              if (sc < bestScore) { bestScore = sc; bestHit = { giant: g, mesh: m, zone, dist, point: wp.clone() }; }
            }
          }
        }
      }
    }
    if (bestHit) {
      const distFactor = clamp(1.25 - bestHit.dist / (maxR * 1.15), 0.45, 1.25);
      const dmg = Math.round((CFG.apgBaseDmg * (doubleShot ? 1.75 : 1.0) * distFactor + this.speed * 5) * this.st.dmgMul);
      const res = bestHit.giant.receiveHit(bestHit.zone, dmg, bestHit.mesh, this.game.ctx);
      if (res.r !== 'nothing') {
        this.game.onPlayerHit(res, bestHit, dmg, bestHit.point);
        this.stress = Math.max(0, this.stress - (res.r === 'kill' ? 33 : 8));
      }
    }
  }

  // RAoT ThunderSpearSingleAttack / ThunderSpearDoubleAttack
  fireSpear(side) {
    const wantDouble = side === 2 && this.spearLoaded[0] && this.spearLoaded[1];
    const indices = [];
    if (wantDouble) {
      indices.push(0, 1);
      this.spearLoaded[0] = false; this.spearLoaded[1] = false;
    } else {
      const pref = side === 1 ? 1 : 0;
      const use = this.spearLoaded[pref] ? pref : (this.spearLoaded[1 - pref] ? 1 - pref : -1);
      if (use < 0) {
        this.game.audio.clang();
        this.game.hud.flashMsg('SEM LANÇAS DO TROVÃO — [R]', '#ff8a6a');
        return;
      }
      indices.push(use);
      this.spearLoaded[use] = false;
    }

    const isDouble = indices.length === 2;
    this.slashCD = 0.38;
    this.slashT = 0.2;
    this.slashHitDone = true;
    this.addStress(isDouble ? 30 : 16);
    this.game.audio.spearLaunch(isDouble);
    this.game.effects.addShake(isDouble ? 0.28 : 0.15);

    const sp = isDouble ? CFG.spearDoubleSpeed : CFG.spearSpeed;
    for (const idx of indices) {
      const sideSign = idx === 0 ? 1 : -1;
      const start = this.pos.clone().add(new THREE.Vector3(0, 0.85, 0)).addScaledVector(this.camRight, sideSign * 0.35).addScaledVector(this.camFwd, 0.7);
      const m = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 1.35), new THREE.MeshBasicMaterial({ color: '#4c804e' }));
      const tip = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 0.32), new THREE.MeshBasicMaterial({ color: '#ff5a3a' }));
      tip.position.z = 0.75;
      m.add(body, tip);
      m.position.copy(start);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), this.camFwd);
      this.scene.add(m);
      const vel = this.camFwd.clone().multiplyScalar(sp);
      this.projectiles.push({
        kind: 'spear', mesh: m, pos: start, vel, age: 0, maxAge: 3.5,
        embedded: false, embedT: 0, targetMesh: null, targetGiant: null, localPos: new THREE.Vector3(),
        blastRadius: isDouble ? CFG.spearDoubleBlastRadius : CFG.spearBlastRadius,
        dmgMul: isDouble ? 1.35 : 1.0,
      });
    }
    this.game.hud.flashMsg('CLIQUE NOVAMENTE PARA DETONAR!', '#ffd27a', 1.1);
  }

  detonateSpear(s) {
    const idx = this.projectiles.indexOf(s);
    if (idx >= 0) this.projectiles.splice(idx, 1);
    this.scene.remove(s.mesh);
    const pos = s.pos.clone();
    this.game.audio.spearExplode();
    this.game.effects.addShake(0.65);
    this.game.effects.sparks(pos, 55);
    this.game.effects.bigSteam(pos, 2.2, 12);
    for (let i = 0; i < 24; i++) {
      const v = new THREE.Vector3(rand(-1, 1), rand(-0.3, 1.2), rand(-1, 1)).normalize().multiplyScalar(rand(8, 26));
      this.game.effects.glow.spawn({ pos, vel: v, size: rand(0.25, 0.55), life: rand(0.25, 0.55), grav: 10, color: i % 2 ? '#ff7a2a' : '#ffe07a', floor: false });
    }

    // Dano explosivo em área (quebra armadura do Blindado instantaneamente!)
    const R = s.blastRadius;
    for (const g of this.game.giants.giants) {
      if (!g.alive) continue;
      // Verifica distância até nuca, olhos e membros
      const checks = [
        ['nape', g.m.nape],
        ['eyes', g.m.head],
        ['armL', g.m.arms.L.elbow],
        ['armR', g.m.arms.R.elbow],
        ['legL', g.m.legs.L.knee],
        ['legR', g.m.legs.R.knee],
      ];
      let hitZone = null, hitMesh = null, bestD = R;
      if (s.targetGiant === g && s.targetMesh) {
        hitMesh = s.targetMesh;
        hitZone = s.targetMesh.userData.zone || 'nape';
        bestD = 0;
      }
      for (const [z, m] of checks) {
        if (!m || !g.isVisible(m)) continue;
        const d = m.getWorldPosition(_a).distanceTo(pos);
        if (d < bestD || (z === 'nape' && d < R * 1.15)) {
          bestD = d; hitZone = z; hitMesh = m;
          if (z === 'nape') break;
        }
      }
      if (hitZone && hitMesh) {
        // Lança do Trovão estraçalha a placa de armadura do Blindado na hora!
        if (g.T.armored && g.armorHP > 0) {
          g.armorHP = 1;
          const bRes = g.receiveHit('nape', 999, g.m.nape, this.game.ctx);
          this.game.onPlayerHit(bRes, { giant: g, mesh: g.m.nape, zone: 'nape' }, 999, pos);
        }
        const dmg = Math.round(CFG.spearBaseDmg * s.dmgMul * this.st.dmgMul);
        const res = g.receiveHit(hitZone, dmg, hitMesh, this.game.ctx);
        if (res.r !== 'nothing') {
          this.game.onPlayerHit(res, { giant: g, mesh: hitMesh, zone: hitZone }, dmg, pos);
          this.stress = Math.max(0, this.stress - (res.r === 'kill' ? 33 : 10));
        }
      }
    }
  }

  updateProjectiles(dt) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.age += dt;
      if (p.kind === 'blade') {
        p.vel.y -= CFG.bladeThrowGrav * dt;
        const step = p.vel.length() * dt;
        const dir = _a.copy(p.vel).normalize();
        const hg = this.game.giants.raycast(p.pos, dir, step + 0.8);
        const hw = this.game.world.raycast(p.pos, dir, step + 0.4);
        p.pos.addScaledVector(p.vel, dt);
        p.mesh.position.copy(p.pos);
        p.mesh.rotation.x += dt * 28;
        if (hg && (!hw || hg.t <= hw.t)) {
          const zone = hg.mesh.userData.zone || 'body';
          const dmg = Math.round((280 + this.speed * 6) * p.durRatio * this.st.dmgMul);
          const res = hg.giant.receiveHit(zone, dmg, hg.mesh, this.game.ctx);
          if (res.r !== 'nothing') {
            this.game.onPlayerHit(res, { giant: hg.giant, mesh: hg.mesh, zone }, dmg, hg.point);
            this.stress = Math.max(0, this.stress - (res.r === 'kill' ? 33 : 8));
          }
          this.game.effects.sparks(hg.point, 12);
          this.scene.remove(p.mesh);
          this.projectiles.splice(i, 1);
          continue;
        }
        if (hw || p.age >= p.maxAge || p.pos.y <= 0.1) {
          this.game.audio.clang();
          this.game.effects.sparks(p.pos, 10);
          this.scene.remove(p.mesh);
          this.projectiles.splice(i, 1);
        }
      } else if (p.kind === 'spear') {
        if (p.embedded) {
          p.embedT += dt;
          if (p.targetMesh && p.targetGiant && p.targetGiant.alive && p.targetGiant.isVisible(p.targetMesh)) {
            p.targetMesh.localToWorld(p.pos.copy(p.localPos));
            p.mesh.position.copy(p.pos);
          }
          if (Math.random() < dt * 20) this.game.effects.sparks(p.pos, 2);
          if (p.embedT >= CFG.spearEmbedTime) this.detonateSpear(p);
        } else {
          const step = p.vel.length() * dt;
          const dir = _a.copy(p.vel).normalize();
          const hg = this.game.giants.raycast(p.pos, dir, step + 0.7);
          const hw = this.game.world.raycast(p.pos, dir, step + 0.5);
          p.pos.addScaledVector(p.vel, dt);
          p.mesh.position.copy(p.pos);
          this.game.effects.puff(p.pos, dir.clone().multiplyScalar(-6), '#f0e6d2', 0.28, 0.35);
          if (hg && (!hw || hg.t <= hw.t)) {
            p.embedded = true;
            p.pos.copy(hg.point);
            p.mesh.position.copy(p.pos);
            p.targetMesh = hg.mesh;
            p.targetGiant = hg.giant;
            hg.mesh.worldToLocal(p.localPos.copy(hg.point));
            this.game.audio.hookHit('flesh');
            this.game.effects.blood(hg.point, null, 6, 0.5);
          } else if (hw || p.pos.y <= 0.2) {
            p.embedded = true;
            if (hw) p.pos.copy(hw.point);
            p.mesh.position.copy(p.pos);
            this.game.audio.hookHit('stone');
            this.game.effects.sparks(p.pos, 10);
          } else if (p.age >= p.maxAge) {
            this.detonateSpear(p);
          }
        }
      }
    }
  }

  startLunge(t) {
    const to = _a.copy(t.point).sub(this.pos).normalize();
    // limite de 60° a partir da mira
    const maxA = (CFG.lungeSteerDeg * Math.PI) / 180;
    const ang = this.camFwd.angleTo(to);
    const dir = this.camFwd.clone();
    if (ang > 1e-4) {
      const axis = _b.copy(this.camFwd).cross(to).normalize();
      dir.applyAxisAngle(axis, Math.min(ang, maxA));
    }
    const sp = Math.max(CFG.lungeMinSpeed, this.speed * 0.8 + 8) * this.stressMul;
    this.vel.copy(dir).multiplyScalar(sp);
    this.lunge = { t: CFG.lungeDuration, target: t, speed: sp, highStress: this.stress >= 75 };
    this.slashCD = CFG.slashCooldown;
    this.gas = Math.max(0, this.gas - 3 * this.st.gasCostMul);
    this.endBurst();
    this.game.audio.lunge();
    const n = this.model.nozzle.getWorldPosition(_c);
    for (let i = 0; i < 10; i++) this.game.effects.gasJet(n, dir, 2);
  }

  endLunge(hit) {
    if (!this.lunge) return;
    const wasHighStress = this.lunge.highStress;
    this.vel.multiplyScalar(hit ? CFG.lungeInherit : 0.75);
    this.lunge = null;
    // RAoT SwordLungeCustomData: errar um lunge aplica +50% stress (e causa overstress se iniciou >= 75%)
    if (!hit) {
      this.addStress(wasHighStress ? 100 : CFG.lungeMissStress);
    }
    for (const h of this.hooks) if (h.attached) h.len = Math.max(h.len, this.pos.distanceTo(h.pivotAnchor(_a)));
  }

  doHit(q, dmgBonus = 1) {
    const G = this.game;
    const spd = this.speed;
    const p = q.mesh.getWorldPosition(new THREE.Vector3());
    const quat = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(new THREE.Vector3(), this.vel.clone().normalize(), UP));
    G.effects.slashArc(this.pos.clone().addScaledVector(this.vel, 0.02), quat, 1.4, '#fff4e8');
    if (this.blades <= 0) {
      G.audio.clang(); G.effects.sparks(p, 8);
      G.hud.flashMsg('LÂMINAS QUEBRADAS — [R]', '#ff8a6a');
      return;
    }
    const dmg = Math.round(spd * CFG.dmgPerSpeed * this.st.dmgMul * dmgBonus);
    const res = q.giant.receiveHit(q.zone, dmg, q.mesh, G.ctx);
    if (res.r === 'nothing') return;
    this.blades = Math.max(0, this.blades - (6 + dmg * 0.025) * this.st.wearMul);
    if (this.blades <= 0) { G.audio.bladeBreak(); G.effects.sparks(this.pos, 16); }
    G.onPlayerHit(res, q, dmg, p);
    this.stress = Math.max(0, this.stress - (res.r === 'kill' ? 33 : 5));
  }

  startReload() {
    if (this.reloadT > 0) return;
    if (this.weapon === 'swords') {
      if (this.bladeSets <= 0 || this.blades >= CFG.bladeDurability) return;
      this.reloadT = 0.75;
      this.game.audio.reload();
    } else if (this.weapon === 'apg') {
      if (this.apgPacks <= 0 || (this.apgLoaded[0] && this.apgLoaded[1])) return;
      this.reloadT = 0.85;
      this.game.audio.reload();
    } else if (this.weapon === 'spears') {
      if (this.spearAmmo <= 0 || (this.spearLoaded[0] && this.spearLoaded[1])) return;
      this.reloadT = 0.95;
      this.game.audio.reload();
    }
  }

  startRoll() {
    const wish = this.wishDir(_a, false);
    if (wish.lengthSq() === 0) wish.set(this.camFwd.x, 0, this.camFwd.z).normalize();
    const sp = Math.min(24, Math.max(Math.hypot(this.vel.x, this.vel.z), 16));
    this.vel.x = wish.x * sp; this.vel.z = wish.z * sp;
    this.rollT = 0.45; this.rollCD = 0.8;
    this.game.audio.land(20);
  }

  tryResupply() {
    if (this.inDepot) { this.resupActive = true; this.resupT = 0; }
    else this.game.hud.flashMsg('Vá até um posto de reabastecimento (feixe dourado)', '#ffd27a');
  }

  fireFlare(kind) {
    if (this.flareCD > 0) return;
    if (this.flares[kind] <= 0) { this.game.hud.flashMsg('Sem sinalizadores — reabasteça', '#ff9a7a'); return; }
    this.flares[kind]--;
    this.flareCD = 0.6;
    this.game.spawnFlare(kind, this.pos.clone().add(new THREE.Vector3(0, 0.8, 0)), this.camFwd.clone().multiplyScalar(70).add(this.vel));
  }

  damage(amount, src) {
    if (!this.alive || this.invuln > 0 || this.game.mode.godMode) return;
    this.hp -= amount;
    this.lastDamageT = this.time;
    this.game.hud.hurt(amount);
    this.game.audio.hurt();
    if (this.hp <= 0) this.die(src);
  }

  die(cause) {
    if (!this.alive) return;
    if (this.game.mode.godMode) { this.hp = this.st.hpMax; return; }
    this.alive = false;
    this.detachAll();
    this.game.onPlayerDeath(cause);
  }

  onGrabbed() {
    this.detachAll();
    this.endBurst();
    this.lunge = null;
    this.escape = 0;
    this.vel.set(0, 0, 0);
    this.game.hud.flashMsg('AGARRADO! CLIQUE RÁPIDO PARA CORTAR!', '#ff5a4a', 1.5);
  }

  struggle() {
    if (this.weapon === 'swords' && this.blades <= 0) { this.game.audio.clang(); return; }
    this.escape++;
    if (this.weapon === 'swords') this.blades = Math.max(0, this.blades - 4);
    this.game.audio.slash();
    this.game.effects.blood(this.pos, null, 6, 0.5);
    if (this.escape >= 6) {
      const g = this.grabbedBy;
      const side = g.grab ? g.grab.side : 'L';
      g.sever('arm' + side, this.game.ctx);
      this.game.onPlayerHit({ r: 'sever', limb: 'arm' + side, dmg: 0 }, { giant: g }, 0, this.pos.clone());
      this.releaseFromGrab(true);
    }
  }

  releaseFromGrab() {
    const g = this.grabbedBy;
    this.grabbedBy = null; this.grabHand = null;
    this.invuln = 1.2;
    if (g) {
      const away = _a.copy(this.pos).sub(g.pos).setY(0).normalize();
      this.vel.copy(away).multiplyScalar(10); this.vel.y = 12;
      if (g.grab) { g.grab = null; g.grabCD = 4; }
    }
  }

  eaten() {
    this.grabbedBy = null;
    this.die('eaten');
  }

  // ================= ATUALIZAÇÃO =================
  update(dt) {
    this.time += dt;
    this.handleInput(dt);
    this.invuln = Math.max(0, this.invuln - dt);
    this.slashCD = Math.max(0, this.slashCD - dt);
    this.spinT = Math.max(0, this.spinT - dt);
    this.reelJerk = Math.max(0, this.reelJerk - dt * 2.2);

    // stress
    this.stressDelay -= dt;
    if (this.stressDelay <= 0) this.stress = Math.max(0, this.stress - this.st.stressRecover * dt);
    if (this.stressed && this.stress < 35) this.stressed = false;

    // recarga (Lâminas, APG ou Lanças do Trovão)
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) {
        if (this.weapon === 'swords') {
          this.blades = CFG.bladeDurability;
          this.bladeSets--;
        } else if (this.weapon === 'apg') {
          this.apgLoaded[0] = true; this.apgLoaded[1] = true;
          this.apgPacks--;
        } else if (this.weapon === 'spears') {
          for (let k = 0; k < 2; k++) {
            if (!this.spearLoaded[k] && this.spearAmmo > 0) { this.spearLoaded[k] = true; this.spearAmmo--; }
          }
        }
        this.game.audio.reloadDone();
      }
    }
    // regeneração leve
    if (this.alive && this.time - this.lastDamageT > 8) this.hp = Math.min(this.st.hpMax, this.hp + 1.5 * dt);
    if (this.st.gasRegen) this.gas = Math.min(this.st.gasMax, this.gas + this.st.gasRegen * dt);
    if (this.game.mode.infiniteGas) this.gas = this.st.gasMax;

    this.updateProjectiles(dt);

    if (this.grabbedBy) {
      this.grabHand.getWorldPosition(this.pos);
      this.pos.y -= 0.9 * this.grabbedBy.s;
      this.vel.set(0, 0, 0);
      this.updateHooks(dt);
    } else if (this.alive) {
      // alvo de lunge (para a mira e para o golpe)
      this.lungeTarget = this.weapon === 'swords'
        ? this.game.giants.lungeTarget(this.pos, this.camFwd, this.st.lungeRange, this.game.world)
        : null;
      const N = 4, h = Math.min(dt, 1 / 30) / N;
      for (let i = 0; i < N; i++) this.step(h);
      this.updateHooks(dt);
      // golpe simples
      if (this.slashT > 0) {
        this.slashT -= dt;
        if (!this.slashHitDone && this.weapon === 'swords') {
          const q = this.game.giants.slashQuery(this.pos, CFG.slashReach);
          if (q) { this.doHit(q); this.slashHitDone = true; }
          if (this.slashT < CFG.slashTime * 0.4) this.slashHitDone = true;
        }
      }
      this.updateResupply(dt);
    }
    this.updateEffects(dt);
  }

  step(h) {
    const I = this.game.input, K = this.game.settings.keys;
    const v = this.vel, p = this.pos;
    const attached = this.hooks.filter((k) => k.attached);
    const hooked = attached.length > 0;
    const doubleMul = attached.length === 2 ? CFG.reelDoubleMul : 1; // RAoT GearDef.reelDoubleMultiplier
    const sm = this.stressMul;

    // gravidade
    v.y -= CFG.gravity * h * (this.lunge ? 0.25 : 1);

    if (this.lunge) {
      const L = this.lunge;
      L.t -= h;
      const tp = L.target.mesh.getWorldPosition(_a);
      const desired = _b.copy(tp).sub(p).normalize();
      const cur = _c.copy(v).normalize();
      cur.lerp(desired, Math.min(1, CFG.lungeTurnRate * h)).normalize();
      v.copy(cur).multiplyScalar(L.speed);
      const g = L.target.giant;
      if (!g.alive || !g.isVisible(L.target.mesh)) this.endLunge(false);
      else if (Giant.meshDistance(L.target.mesh, p) < CFG.slashReach * 0.8) {
        this.doHit({ giant: g, mesh: L.target.mesh, zone: L.target.mesh.userData.zone });
        this.anim.slashSide *= -1;
        this.slashT = CFG.slashTime * 0.6; this.slashHitDone = true;
        this.endLunge(true);
      } else if (L.t <= 0) this.endLunge(false);
    } else {
      const wish = this.wishDir(_d, false);
      if (this.onGround && !hooked) {
        // chão: corrida / deslize (aterrissar rápido desliza; rolamento preserva o impulso)
        const sliding = (this.slideT > 0 || this.rollT > 0) && Math.hypot(v.x, v.z) > CFG.runSpeed * 0.8;
        if (!sliding) {
          const tx = wish.x * CFG.runSpeed * sm, tz = wish.z * CFG.runSpeed * sm;
          const ax = tx - v.x, az = tz - v.z;
          const al = Math.hypot(ax, az);
          const acc = (wish.lengthSq() > 0 ? CFG.groundAccel : CFG.groundAccel * 0.6) * h;
          if (al > acc) { v.x += (ax / al) * acc; v.z += (az / al) * acc; } else { v.x = tx; v.z = tz; }
        } else {
          const f = Math.max(0, 1 - CFG.slideFriction * h);
          v.x *= f; v.z *= f;
        }
      } else if (wish.lengthSq() > 0) {
        if (hooked) {
          // balanço: força perpendicular ao cabo (usando o pivô ativo de dobra)
          const n = attached[0].pivotAnchor(_a).sub(p).normalize();
          const t = _b.copy(wish).addScaledVector(n, -wish.dot(n));
          v.addScaledVector(t, CFG.swingAccel * h);
        } else {
          const along = v.dot(wish);
          if (along < CFG.runSpeed * 1.4) v.addScaledVector(wish, CFG.airAccel * h);
        }
      }

      // burst (6 direções + escala por direção)
      if (this.burst && this.gas > 0) {
        const B = this.burst;
        const dir = B.dir;
        const target = (this.st.burstSpeed + (hooked ? 12 : 0)) * sm * (B.scale || 1);
        const vd = v.dot(dir);
        if (vd < target) {
          const add = Math.min(CFG.burstAccel * h, target - vd);
          v.addScaledVector(dir, add);
        }
        this.gas = Math.max(0, this.gas - CFG.burstSustainCost * this.st.gasCostMul * h);
        if (this.gas <= 0) this.endBurst();
      }

      // Reel In / Gás (Espaço): com gancho puxa para o pivô; com 2 ganchos usa reelDoubleMul
      this.gasFlow = 0;
      if (I.down(K.reel) && this.gas > 0) {
        if (hooked) {
          const n = _a.set(0, 0, 0);
          for (const k of attached) n.add(_b.copy(k.pivotAnchor(_c)).sub(p).normalize());
          n.normalize();
          const vr = v.dot(n);
          const target = this.st.reelSpeed * doubleMul * sm;
          if (vr < target) v.addScaledVector(n, Math.min(this.st.reelAccel * doubleMul * h, target - vr));
          this.gas = Math.max(0, this.gas - CFG.gasReel * this.st.gasCostMul * h);
          this.gasFlow = 1;
        } else if (!this.onGround) {
          const vd = v.dot(this.camFwd);
          const target = this.st.burstSpeed * 0.85 * sm;
          if (vd < target) v.addScaledVector(this.camFwd, Math.min(CFG.thrustAccel * h, target - vd));
          this.gas = Math.max(0, this.gas - CFG.gasThrust * this.st.gasCostMul * h);
          this.gasFlow = 1;
        }
      }
      // Subir (E) / Descer (Q) com gás no ar
      if (!this.onGround && this.gas > 0) {
        const up = I.down(K.up), dn = I.down(K.down);
        if (up !== dn) {
          const dir = up ? 1 : -1;
          const target = (up ? CFG.verticalSpeed : CFG.verticalSpeed * 1.4) * sm;
          const vy = v.y * dir;
          if (vy < target) v.y += dir * Math.min(CFG.verticalAccel * h, target - vy);
          this.gas = Math.max(0, this.gas - CFG.gasVertical * this.st.gasCostMul * h);
          this.gasFlow = 1;
        }
      }
    }

    // arrasto quadrático leve
    const sp = v.length();
    if (sp > 0.01) {
      v.multiplyScalar(Math.max(0, 1 - CFG.airDrag * sp * h));
      if (sp > CFG.maxSpeed) v.multiplyScalar(CFG.maxSpeed / sp);
    }

    // integra
    p.addScaledVector(v, h);

    // cabos: restrição inextensível com catraca no pivô ativo (e ReelBrakeEffect ao soltar cabo sob tensão)
    if (!this.lunge) {
      const slack = I.down(K.reelOut);
      for (let it = 0; it < 2; it++) {
        for (const k of attached) {
          const a = k.pivotAnchor(_a);
          const d = _b.copy(p).sub(a);
          const L = d.length();
          if (slack) {
            k.len = Math.min(this.st.hookRange * 1.2, k.len + CFG.slackSpeed * h / 2);
            // RAoT ReelBrakeEffect: faíscas no carretel ao frear/soltar cabo em alta velocidade
            if (it === 0 && L >= k.len - 0.5 && v.dot(d) / Math.max(1, L) > 6 && Math.random() < h * 18) {
              this.game.effects.sparks(this.launcherPos(k, _c), 2);
              this.game.audio.reelBrake();
            }
          } else k.len = Math.max(CFG.hookMinLen, Math.min(k.len, L));
          if (L > k.len && L > 1e-4) {
            d.divideScalar(L);
            p.copy(a).addScaledVector(d, k.len);
            const vr = v.dot(d);
            if (vr > 0) v.addScaledVector(d, -vr);
          }
        }
      }
    }

    // colisões
    const info = this.game.world.collideSphere(p, v, CFG.playerRadius, this.info);
    const touched = this.game.giants.collidePlayer(p, v, CFG.playerRadius);
    const wasGround = this.onGround;
    this.onGround = info.onGround;
    this.rollT = Math.max(0, this.rollT - h);
    this.slideT = Math.max(0, this.slideT - h);
    if (!wasGround && this.onGround) {
      if (I.down(K.hardLand)) {
        // aterrissagem dura: freia e absorve o impacto do chão
        v.x *= 0.15; v.z *= 0.15;
        if (info.normal.y > 0.5) info.impact = Math.min(info.impact, CFG.impactDamageSpeed);
        this.game.audio.land(30);
      } else if (Math.hypot(v.x, v.z) > CFG.runSpeed + 2) this.slideT = 0.6;
    }
    if (info.impact > CFG.impactDamageSpeed && !this.lunge) {
      this.damage((info.impact - CFG.impactDamageSpeed) * 2.2, 'impact');
      this.game.effects.addShake(0.5);
      this.game.effects.dust(p, 1.5, 8);
    } else if (info.impact > 14) {
      this.game.audio.land(info.impact);
    }
    if (!wasGround && this.onGround && info.impact > 8) this.game.effects.dust(_a.copy(p).setY(p.y - 0.4), 1.2, 6);
    if (this.lunge && (info.hit && info.impact > 3)) this.endLunge(false);
    if (touched && this.lunge && touched !== this.lunge.target.giant) this.endLunge(false);
  }

  updateResupply(dt) {
    let inZone = null;
    for (const d of this.game.world.depots) if (this.pos.distanceTo(d.pos) < d.radius) inZone = d;
    if (inZone && this.resupActive && this.speed < 14) {
      const need = this.gas < this.st.gasMax - 1 || this.blades < CFG.bladeDurability || this.bladeSets < this.st.bladeSetsMax ||
        this.apgPacks < CFG.apgPacks || !this.apgLoaded[0] || !this.apgLoaded[1] ||
        this.spearAmmo < CFG.spearMaxAmmo || !this.spearLoaded[0] || !this.spearLoaded[1] ||
        this.hp < this.st.hpMax || this.flares.smoke < 3 || this.flares.acoustic < 2;
      if (need) {
        this.resupT += dt;
        if (this.resupT >= 1.6) {
          this.gas = this.st.gasMax;
          this.blades = CFG.bladeDurability; this.bladeSets = this.st.bladeSetsMax;
          this.apgLoaded[0] = true; this.apgLoaded[1] = true; this.apgPacks = CFG.apgPacks;
          this.spearLoaded[0] = true; this.spearLoaded[1] = true; this.spearAmmo = CFG.spearMaxAmmo;
          this.hp = Math.min(this.st.hpMax, this.hp + 40);
          this.flares.smoke = 3; this.flares.acoustic = 2;
          this.resupT = 0; this.resupActive = false;
          this.game.audio.resupply();
          this.game.hud.flashMsg('REABASTECIDO', '#ffd27a');
        }
      } else { this.resupT = 0; this.resupActive = false; this.game.hud.flashMsg('Equipamento já está cheio', '#ffd27a'); }
    } else { this.resupT = 0; this.resupActive = false; } // cancela se sair da zona
    this.inDepot = inZone;
  }

  // ================= VISUAL / CÂMERA =================
  updateEffects(dt) {
    const G = this.game;
    const sp = this.speed;
    // jatos de gás contínuos
    const gasOn = this.alive && !this.grabbedBy && this.gas > 0 && (!!this.burst || this.gasFlow > 0 || !!this.lunge);
    if (gasOn) {
      const n = this.model.nozzle.getWorldPosition(_c);
      G.effects.gasJet(n, this.burst ? this.burst.dir : this.vel.clone().normalize(), 1);
    }
    G.audio.setGas(gasOn ? 1 : 0);
    G.audio.setWind(sp);
    this.animateModel(dt);
    this.updateCamera(dt);
    this.updateRopes();
  }

  animateModel(dt) {
    const M = this.model, sp = this.speed, v = this.vel;
    M.group.visible = (this.alive || this.grabbedBy) && !this.firstPerson;
    M.group.position.set(this.pos.x, this.pos.y + 0.32, this.pos.z);
    const horiz = Math.hypot(v.x, v.z);
    let yawT;
    if (this.onGround && horiz > 1 && !this.hookedCount) yawT = Math.atan2(v.x, v.z);
    else if (!this.onGround && sp > 6) yawT = Math.atan2(v.x, v.z);
    else yawT = Math.atan2(this.camFwd.x, this.camFwd.z);
    if (this.poised || this.slashT > 0) yawT = Math.atan2(this.camFwd.x, this.camFwd.z);
    let dy = yawT - M.group.rotation.y;
    while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2;
    M.group.rotation.y += dy * Math.min(1, dt * 10);
    if (this.spinT > 0) M.group.rotation.y += (1 - this.spinT / 0.36) * Math.PI * 4;

    const air = !this.onGround;
    const lean = air ? clamp(sp / 35, 0, 1) * 0.9 : clamp(horiz / CFG.runSpeed, 0, 1) * 0.15;
    if (M.root.rotation.x > Math.PI) M.root.rotation.x -= Math.PI * 2;
    M.root.rotation.x = damp(M.root.rotation.x, lean, 6, dt);
    M.root.rotation.z = damp(M.root.rotation.z, clamp(-dy * 0.8, -0.6, 0.6), 5, dt);
    // pernas
    this.anim.run += dt * horiz * 1.4;
    const run = this.onGround ? clamp(horiz / CFG.runSpeed, 0, 1) : 0;
    const s = Math.sin(this.anim.run);
    M.legL.rotation.x = damp(M.legL.rotation.x, air ? -0.5 : -s * 0.9 * run, 10, dt);
    M.legR.rotation.x = damp(M.legR.rotation.x, air ? -0.2 : s * 0.9 * run, 10, dt);
    M.shinL.rotation.x = damp(M.shinL.rotation.x, air ? 0.9 : Math.max(0, s) * 1.1 * run, 10, dt);
    M.shinR.rotation.x = damp(M.shinR.rotation.x, air ? 0.5 : Math.max(0, -s) * 1.1 * run, 10, dt);
    // braços: postura, golpe, emote ou neutro
    let aL = -0.3, aR = -0.3, zL = 0.25, zR = -0.25, fL = -0.6, fR = -0.6;
    if (this.poised || this.lunge) {
      if (this.weapon === 'swords') { aL = -2.2; aR = -2.2; zL = 0.6; zR = -0.6; fL = -0.4; fR = -0.4; }
      else { aL = -1.55; aR = -1.55; zL = 0.18; zR = -0.18; fL = -0.1; fR = -0.1; }
    }
    if (this.slashT > 0) {
      const k = this.slashT / CFG.slashTime;
      aL = aR = -1.6 + (1 - k) * 2.4; zL = 0.9 * k; zR = -0.9 * k; fL = fR = -0.2;
    }
    if (!air && !this.poised && this.slashT <= 0) { aL += s * 0.6 * run; aR -= s * 0.6 * run; }
    if (this.grabbedBy) { aL = -2.8; aR = -2.8; }
    if (this.emoteT > 0) {
      if (this.emoteIdx === 0) { // Saudação (punho direito no peito)
        aR = -1.6; zR = 0.75; fR = -1.55; aL = -0.15; zL = -0.15;
      } else if (this.emoteIdx === 1) { // Acenar
        aR = -2.9; zR = -0.4 + Math.sin(this.time * 14) * 0.5; fR = -0.3;
      } else if (this.emoteIdx === 2) { // Vitória (ambos os braços erguidos)
        aL = -2.85; aR = -2.85; zL = 0.45; zR = -0.45; fL = -0.2; fR = -0.2;
      } else { // Inspecionar arma
        aR = -1.8; zR = 0.35; fR = -0.9 + Math.sin(this.time * 8) * 0.35;
      }
    }
    if (this.rollT > 0) { M.root.rotation.x = (1 - this.rollT / 0.45) * Math.PI * 2; }
    M.armL.rotation.x = damp(M.armL.rotation.x, aL, 16, dt); M.armR.rotation.x = damp(M.armR.rotation.x, aR, 16, dt);
    M.armL.rotation.z = damp(M.armL.rotation.z, zL, 12, dt); M.armR.rotation.z = damp(M.armR.rotation.z, zR, 12, dt);
    M.foreL.rotation.x = damp(M.foreL.rotation.x, fL, 12, dt); M.foreR.rotation.x = damp(M.foreR.rotation.x, fR, 12, dt);

    // Visibilidade da arma equipada
    M.bladeL.visible = M.bladeR.visible = this.weapon === 'swords' && this.blades > 0 && this.reloadT <= 0;
    M.apgL.visible = M.apgR.visible = this.weapon === 'apg';
    M.spearL.visible = this.weapon === 'spears' && this.spearLoaded[0] && this.reloadT <= 0;
    M.spearR.visible = this.weapon === 'spears' && this.spearLoaded[1] && this.reloadT <= 0;

    // capa
    const cf = clamp(sp / 30, 0, 1);
    M.cape.rotation.x = damp(M.cape.rotation.x, cf * 1.1 + Math.sin(this.time * 14) * 0.08 * cf, 8, dt);
    M.cape2.rotation.x = damp(M.cape2.rotation.x, cf * 0.5 + Math.sin(this.time * 17 + 1) * 0.15 * cf, 8, dt);
  }

  updateCamera(dt) {
    const cam = this.game.camera, G = this.game;
    const sp = this.speed;
    const target = _a.copy(this.pos); target.y += 1.05;
    if (this.firstPerson && !this.grabbedBy) {
      cam.position.copy(target).addScaledVector(this.camFwd, 0.22);
    } else {
      // RAoT AttackZoomStrength + reelJerkValue
      const poisePull = this.poised ? -0.65 : 0;
      const dist = (this.grabbedBy ? 9 : 5.2 + poisePull - this.reelJerk * 0.9) + clamp(sp * 0.035, 0, 2.2);
      this.camDist = damp(this.camDist, dist, 5, dt);
      const desired = _b.copy(target).addScaledVector(this.camFwd, -this.camDist).addScaledVector(this.camRight, 0.55);
      desired.y += 0.35;
      // colisão da câmera
      const dir = _c.copy(desired).sub(target);
      const len = dir.length();
      dir.divideScalar(len);
      const hit = G.world.raycast(target, dir, len);
      if (hit) desired.copy(target).addScaledVector(dir, Math.max(0.4, hit.t - 0.35));
      if (desired.y < 0.3) desired.y = 0.3;
      cam.position.copy(desired);
    }
    // tremor (efeitos + tremor leve de overstress como no StressHUD.stressShaker do RAoT)
    const sh = G.effects.shake + (this.stressed ? 0.06 : 0);
    if (sh > 0) cam.position.add(new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(sh * 0.35));
    cam.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
    // FOV dinâmico com a velocidade + zoom sutil em postura
    const fovT = G.settings.fov + clamp((sp - 14) * 0.38, 0, 20) - (this.poised ? 3.5 : 0);
    this.fov = damp(this.fov, fovT, 4, dt);
    if (Math.abs(cam.fov - this.fov) > 0.05) { cam.fov = this.fov; cam.updateProjectionMatrix(); }
  }

  placeRopeSegment(mesh, p0, p1) {
    const d = _b.copy(p1).sub(p0);
    const L = d.length();
    if (L < 0.01) { mesh.visible = false; return; }
    mesh.visible = true;
    mesh.position.copy(p0);
    mesh.quaternion.setFromUnitVectors(UP, d.divideScalar(L));
    mesh.scale.set(1, L, 1);
  }

  updateRopes() {
    for (const h of this.hooks) {
      if (h.state === 'idle') {
        h.rope.visible = false;
        h.head.visible = false;
        for (const wr of h.wrapRopes) wr.visible = false;
        continue;
      }
      const start = this.launcherPos(h, _a);
      if (h.wraps.length === 0) {
        for (const wr of h.wrapRopes) wr.visible = false;
        this.placeRopeSegment(h.rope, start, h.tip);
      } else {
        // Polilinha 3D completa: lançador -> última quina -> ... -> primeira quina -> âncora
        const lastWrap = h.wraps[h.wraps.length - 1].point;
        this.placeRopeSegment(h.rope, start, lastWrap);
        for (let i = 0; i < h.wrapRopes.length; i++) {
          const wr = h.wrapRopes[i];
          if (i < h.wraps.length) {
            const fromPt = h.wraps[i].point;
            const toPt = i === 0 ? h.tip : h.wraps[i - 1].point;
            this.placeRopeSegment(wr, fromPt, toPt);
          } else wr.visible = false;
        }
      }
      h.head.visible = true;
      h.head.position.copy(h.tip);
      h.head.quaternion.copy(h.rope.quaternion).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2));
    }
  }

  // Ponto onde a mira está apontando (para o HUD), incluindo preview de Split Hooks.
  aimInfo() {
    const cam = this.game.camera;
    const camToPlayer = cam.position.distanceTo(this.pos);
    const origin = cam.position.clone().addScaledVector(this.camFwd, Math.max(0, camToPlayer - 0.6));
    const range = this.st.hookRange * 1.6;
    const hit = this.raycastHook(origin, this.camFwd, range, true);
    const split = this.game.input.down(this.game.settings.keys.split);
    let splitL = false, splitR = false;
    if (split) {
      const dirL = this.camFwd.clone().applyAxisAngle(UP, CFG.splitAngle);
      const dirR = this.camFwd.clone().applyAxisAngle(UP, -CFG.splitAngle);
      const hL = this.raycastHook(origin, dirL, this.st.hookRange + 2, true);
      const hR = this.raycastHook(origin, dirR, this.st.hookRange + 2, true);
      splitL = !!(hL && hL.point.distanceTo(this.pos) <= this.st.hookRange);
      splitR = !!(hR && hR.point.distanceTo(this.pos) <= this.st.hookRange);
    }
    if (!hit) return { inRange: false, dist: Infinity, split, splitL, splitR };
    const d = hit.point.distanceTo(this.pos);
    return {
      inRange: d <= this.st.hookRange,
      dist: d,
      giant: !!hit.giant,
      retargeted: !!hit.retargeted,
      split,
      splitL,
      splitR,
    };
  }
}
