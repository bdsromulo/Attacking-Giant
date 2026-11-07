import * as THREE from 'three';
import { CFG } from './config.js';
import { WEAPON_NAMES } from './player.js';
import { clamp, angleDiff } from './util.js';

const $ = (id) => document.getElementById(id);
const _p = new THREE.Vector3();

const CARDINALS = [
  [0, 'N'], [Math.PI / 4, 'NE'], [Math.PI / 2, 'L'], [(3 * Math.PI) / 4, 'SE'],
  [Math.PI, 'S'], [(-3 * Math.PI) / 4, 'SO'], [-Math.PI / 2, 'O'], [-Math.PI / 4, 'NO'],
];

export class HUD {
  constructor(game) {
    this.game = game;
    this.root = $('hud');
    this.el = {};
    for (const id of ['vignette', 'hurtflash', 'waveLabel', 'waveSub', 'score', 'combo', 'feed', 'msg', 'bigmsg', 'chL', 'chR', 'chDot', 'chDist',
      'resup', 'resupFill', 'grabMeter', 'grabFill', 'hpFill', 'gasFill', 'gasNum', 'stressFill', 'bladeFill', 'bladeSets', 'speed', 'hookState', 'dmgLayer'])
      this.el[id] = $(id);
    this.radar = $('radar').getContext('2d');
    this.msgT = 0; this.bigT = 0; this.hurtA = 0;
    this.nums = [];
    this.aimTimer = 0;
    this.aim = { inRange: false, dist: Infinity, split: false, splitL: false, splitR: false };
    this.lastSets = -1;

    // Bússola superior estilo RAoT (CompassHud)
    this.compass = document.createElement('canvas');
    this.compass.id = 'compass';
    this.compass.width = 360;
    this.compass.height = 24;
    this.root.appendChild(this.compass);
    this.compassCtx = this.compass.getContext('2d');

    // Medidores de postura e medidor central de stress (StressHUD.centerMeter do RAoT)
    const ch = $('crosshair');
    this.gL = document.createElement('div'); this.gL.className = 'gauge gl'; this.gL.innerHTML = '<i></i>';
    this.gR = document.createElement('div'); this.gR.className = 'gauge gr'; this.gR.innerHTML = '<i></i>';
    this.centerStress = document.createElement('div');
    this.centerStress.id = 'centerStress';
    this.centerStress.innerHTML = '<i></i>';
    ch.append(this.gL, this.gR, this.centerStress);

    // Seletor de armas (1: Lâminas, 2: APG, 3: Lanças do Trovão) + sinalizadores
    this.weaponLabel = this.el.bladeFill.parentElement.previousElementSibling;
    this.weaponSwitchEl = document.createElement('div');
    this.weaponSwitchEl.id = 'weaponSwitch';
    $('gear').appendChild(this.weaponSwitchEl);

    this.flaresEl = document.createElement('div'); this.flaresEl.id = 'flares';
    $('gear').appendChild(this.flaresEl);
    this.board = document.createElement('div'); this.board.id = 'board'; this.board.className = 'hidden';
    this.root.appendChild(this.board);
  }

  show() { this.root.classList.remove('hidden'); }
  hide() { this.root.classList.add('hidden'); }

  flashMsg(text, color = '#f3ece0', dur = 1.1) {
    this.el.msg.textContent = text;
    this.el.msg.style.color = color;
    this.el.msg.style.opacity = 1;
    this.msgT = dur;
  }
  bigMsg(text, sub = '', dur = 2.2) {
    this.el.bigmsg.innerHTML = text + (sub ? `<small>${sub}</small>` : '');
    this.el.bigmsg.style.opacity = 1;
    this.bigT = dur;
  }
  feed(text) {
    const d = document.createElement('div');
    d.textContent = text;
    this.el.feed.prepend(d);
    while (this.el.feed.children.length > 6) this.el.feed.lastChild.remove();
    setTimeout(() => d.remove(), 6000);
  }
  hurt(a) { this.hurtA = Math.min(1, this.hurtA + a / 40); }
  setWave(label, sub) { this.el.waveLabel.textContent = label; this.el.waveSub.textContent = sub; }
  setScore(score, combo) {
    this.el.score.textContent = Math.round(score).toLocaleString('pt-BR');
    this.el.combo.textContent = combo > 1 ? `COMBO x${combo}` : '';
  }

  damageNumber(pos, text, cls = '') {
    const d = document.createElement('div');
    d.className = 'dmg ' + cls;
    d.textContent = text;
    this.el.dmgLayer.appendChild(d);
    this.nums.push({ d, pos: pos.clone(), t: 1.1, vy: 0 });
  }

  clearTransient() {
    for (const n of this.nums) n.d.remove();
    this.nums.length = 0;
    this.el.feed.innerHTML = '';
    this.el.msg.style.opacity = 0; this.el.bigmsg.style.opacity = 0;
  }

  update(dt) {
    const G = this.game, P = G.player;
    // mensagens
    if (this.msgT > 0) { this.msgT -= dt; if (this.msgT <= 0) this.el.msg.style.opacity = 0; }
    if (this.bigT > 0) { this.bigT -= dt; if (this.bigT <= 0) this.el.bigmsg.style.opacity = 0; }
    this.hurtA = Math.max(0, this.hurtA - dt * 1.5);
    this.el.hurtflash.style.opacity = this.hurtA + (P.hp < 30 && P.alive ? 0.25 + Math.sin(performance.now() * 0.008) * 0.1 : 0);

    // barras principais
    this.el.hpFill.style.width = clamp(P.hp / P.st.hpMax, 0, 1) * 100 + '%';
    const gp = P.gas / P.st.gasMax;
    this.el.gasFill.style.width = clamp(gp, 0, 1) * 100 + '%';
    this.el.gasFill.classList.toggle('low', gp < 0.2);
    this.el.gasNum.textContent = Math.round(P.gas);
    this.el.stressFill.style.width = P.stress + '%';
    this.el.stressFill.classList.toggle('max', P.stressed);

    // medidor central de stress próximo à mira (como no StressHUD.centerMeter do RAoT)
    this.centerStress.style.opacity = P.stress > 3 ? 0.9 : 0;
    this.centerStress.firstChild.style.width = P.stress + '%';
    this.centerStress.firstChild.className = P.stressed ? 'max' : '';

    // barra e estoque da arma ativa (Lâminas ODM / APG / Lanças do Trovão)
    let weapPct = 100, weapBroken = false, curReserve = 0, maxReserve = 0, weapShort = 'LÂMINA';
    if (P.weapon === 'swords') {
      weapShort = 'LÂMINA';
      weapPct = P.reloadT > 0 ? (1 - P.reloadT / 0.75) * 100 : P.blades;
      weapBroken = P.blades <= 0;
      curReserve = P.bladeSets; maxReserve = P.st.bladeSetsMax;
    } else if (P.weapon === 'apg') {
      weapShort = 'CARTUCHO';
      const loadedCount = (P.apgLoaded[0] ? 1 : 0) + (P.apgLoaded[1] ? 1 : 0);
      weapPct = P.reloadT > 0 ? (1 - P.reloadT / 0.85) * 100 : (loadedCount / 2) * 100;
      weapBroken = loadedCount === 0;
      curReserve = P.apgPacks; maxReserve = CFG.apgPacks;
    } else {
      weapShort = 'LANÇAS';
      const loadedCount = (P.spearLoaded[0] ? 1 : 0) + (P.spearLoaded[1] ? 1 : 0);
      weapPct = P.reloadT > 0 ? (1 - P.reloadT / 0.95) * 100 : (loadedCount / 2) * 100;
      weapBroken = loadedCount === 0;
      curReserve = P.spearAmmo; maxReserve = CFG.spearMaxAmmo;
    }
    if (this.weaponLabel) this.weaponLabel.textContent = weapShort;
    this.el.bladeFill.style.width = clamp(weapPct, 0, 100) + '%';
    this.el.bladeFill.classList.toggle('broken', weapBroken);

    const setsKey = `${P.weapon}:${curReserve}:${maxReserve}`;
    if (setsKey !== this.lastSets) {
      this.lastSets = setsKey;
      this.el.bladeSets.innerHTML = '';
      for (let i = 0; i < maxReserve; i++) {
        const b = document.createElement('i');
        if (i >= curReserve) b.className = 'used';
        this.el.bladeSets.appendChild(b);
      }
      this.weaponSwitchEl.innerHTML = [
        ['swords', '1:ODM'],
        ['apg', '2:APG'],
        ['spears', '3:LANÇA'],
      ].map(([k, lbl]) => `<span class="${P.weapon === k ? 'active' : ''}">${lbl}</span>`).join('');
    }

    const sp = P.speed;
    this.el.speed.textContent = Math.round(sp);
    const K = G.settings.keys;
    const kn = G.keyName;
    this.el.hookState.textContent = P.stressed
      ? 'OVERSTRESS!'
      : (P.inDepot ? `[${kn(K.interact)}] REABASTECER` : (P.poised ? `POSTURA · ${WEAPON_NAMES[P.weapon]}` : ''));
    this.flaresEl.textContent = `FUMAÇA ${P.flares.smoke}  ·  ACÚSTICO ${P.flares.acoustic}`;

    // medidores de postura ao lado da mira: munição/lâmina (esq.) e gás (dir.)
    this.gL.style.opacity = this.gR.style.opacity = P.poised ? 1 : 0;
    this.gL.firstChild.style.height = clamp(weapPct / 100, 0, 1) * 100 + '%';
    this.gR.firstChild.style.height = clamp(P.gas / P.st.gasMax, 0, 1) * 100 + '%';

    // placar (Tab)
    const showBoard = G.input.down(K.scoreboard);
    this.board.classList.toggle('hidden', !showBoard);
    if (showBoard && G.stats) {
      const st = G.stats;
      this.board.innerHTML = '<h3>ESTATÍSTICAS</h3>' + [
        ['Modo', G.mode.key.toUpperCase()],
        ['Equipamento', WEAPON_NAMES[P.weapon]],
        ['Pontuação', Math.round(G.score || 0).toLocaleString('pt-BR')],
        ['Gigantes abatidos', st.kills], ['Membros cortados', st.severs],
        ['Maior dano', st.bestHit], ['Velocidade máxima', Math.round(st.maxSpeed) + ' m/s'],
        ['Tempo', Math.floor(st.time / 60) + 'min ' + Math.floor(st.time % 60) + 's'],
      ].map(([a, b]) => `<div>${a}<b>${b}</b></div>`).join('');
    }
    this.el.vignette.style.opacity = clamp((sp - 22) / 40, 0, 0.9);

    // mira e colchetes dos ganchos (CrosshairElement.TravelTo do RAoT)
    this.aimTimer -= dt;
    if (this.aimTimer <= 0) { this.aim = P.aimInfo(); this.aimTimer = 0.04; }
    const dot = this.el.chDot;
    if (P.poised) {
      const hasTarget = P.weapon === 'swords' ? !!P.lungeTarget : this.aim.inRange;
      dot.className = 'ch-dot' + (hasTarget ? ' lunge' : ' out');
    } else {
      dot.className = 'ch-dot' + (!this.aim.inRange ? ' out' : (this.aim.giant ? ' giant' : ''));
    }
    this.el.chDist.textContent = this.aim.dist < 999 ? Math.round(this.aim.dist) + 'm' : '—';

    const cam = G.camera, w = window.innerWidth, h = window.innerHeight;
    for (const [i, el] of [[0, this.el.chL], [1, this.el.chR]]) {
      const hk = P.hooks[i];
      const split = this.aim.split;
      const splitOk = i === 0 ? this.aim.splitL : this.aim.splitR;
      el.className = 'ch-hook' + (
        hk.state === 'attached' ? ' attached'
        : hk.state === 'flying' ? ' flying'
        : split ? (splitOk ? ' split-ok' : ' split-out')
        : ''
      );
      if (hk.state === 'attached' || hk.state === 'flying') {
        _p.copy(hk.tip).project(cam);
        if (_p.z > 0 && _p.z < 1) {
          const sx = clamp(_p.x * (w * 0.5), -w * 0.44, w * 0.44);
          const sy = clamp(-_p.y * (h * 0.5), -h * 0.44, h * 0.44);
          el.style.transform = `translate(${Math.round(sx)}px, ${Math.round(sy)}px)`;
          continue;
        }
      }
      const splitOffset = split ? (i === 0 ? -24 : 24) : 0;
      el.style.transform = `translate(${splitOffset}px, 0px)`;
    }

    // reabastecimento / agarrão
    this.el.resup.style.opacity = P.resupT > 0 ? 1 : 0;
    this.el.resupFill.style.width = clamp(P.resupT / 1.6, 0, 1) * 100 + '%';
    this.el.grabMeter.style.opacity = P.grabbedBy ? 1 : 0;
    this.el.grabFill.style.width = clamp(P.escape / 6, 0, 1) * 100 + '%';

    // números de dano
    for (let i = this.nums.length - 1; i >= 0; i--) {
      const n = this.nums[i];
      n.t -= dt;
      n.pos.y += dt * 2.5;
      _p.copy(n.pos).project(cam);
      if (n.t <= 0 || _p.z > 1) { n.d.remove(); this.nums.splice(i, 1); continue; }
      n.d.style.left = ((_p.x + 1) / 2) * w + 'px';
      n.d.style.top = ((1 - _p.y) / 2) * h + 'px';
      n.d.style.opacity = Math.min(1, n.t * 2);
    }

    this.drawCompass();
    this.drawRadar();
  }

  drawCompass() {
    const c = this.compassCtx, G = this.game, P = G.player;
    const W = 360, H = 24, half = W / 2, span = Math.PI * 0.75;
    c.clearRect(0, 0, W, H);
    c.fillStyle = 'rgba(15,14,12,0.45)';
    c.fillRect(0, 0, W, H);
    // olhar do jogador no plano XZ (0 = Norte/-Z)
    const heading = Math.atan2(-P.camFwd.x, -P.camFwd.z);
    c.font = 'bold 11px "Segoe UI", sans-serif';
    c.textAlign = 'center';
    for (const [ang, lbl] of CARDINALS) {
      const diff = angleDiff(ang, heading);
      if (Math.abs(diff) > span) continue;
      const x = half - (diff / span) * (half - 16);
      c.fillStyle = lbl.length === 1 ? '#e0b45a' : 'rgba(243,236,224,0.65)';
      c.fillText(lbl, x, 15);
      c.fillRect(x - 0.5, 18, 1, 4);
    }
    // marcadores de gigantes vivos na bússola
    for (const g of G.giants.giants) {
      if (!g.alive) continue;
      const ga = Math.atan2(-(g.pos.x - P.pos.x), -(g.pos.z - P.pos.z));
      const diff = angleDiff(ga, heading);
      if (Math.abs(diff) > span) continue;
      const x = half - (diff / span) * (half - 16);
      c.fillStyle = g.T.boss ? '#ff3a2a' : '#ff8a6a';
      c.beginPath(); c.arc(x, 5, g.T.boss ? 3.5 : 2.2, 0, Math.PI * 2); c.fill();
    }
    // marca central
    c.fillStyle = '#ffffff';
    c.fillRect(half - 1, 0, 2, 4);
  }

  drawRadar() {
    const c = this.radar, G = this.game, P = G.player;
    const W = 170, R = 85, scale = R / 180;
    c.clearRect(0, 0, W, W);
    c.save();
    c.beginPath(); c.arc(R, R, R - 1, 0, Math.PI * 2); c.clip();
    c.translate(R, R);
    c.rotate(P.yaw);
    const tx = (x, z) => [(x - P.pos.x) * scale, (z - P.pos.z) * scale];
    // muralha
    c.strokeStyle = 'rgba(200,190,170,.55)'; c.lineWidth = 3;
    c.beginPath();
    const [wx, wz] = tx(0, 0);
    c.arc(wx, wz, CFG.WALL_R * scale, CFG.BREACH_ANGLE + CFG.BREACH_HALF, CFG.BREACH_ANGLE - CFG.BREACH_HALF + Math.PI * 2);
    c.stroke();
    // depósitos
    c.fillStyle = '#ffd27a';
    for (const d of G.world.depots) { const [x, z] = tx(d.pos.x, d.pos.z); c.fillRect(x - 3, z - 3, 6, 6); }
    // anéis de corrida
    if (G.race) {
      G.race.rings.forEach((r, i) => {
        if (i < G.race.idx) return;
        const [x, z] = tx(r.pos.x, r.pos.z);
        c.strokeStyle = i === G.race.idx ? '#5dff7a' : 'rgba(93,255,122,.35)'; c.lineWidth = 2;
        c.beginPath(); c.arc(x, z, i === G.race.idx ? 5 : 3, 0, Math.PI * 2); c.stroke();
      });
    }
    // gigantes
    for (const g of G.giants.giants) {
      const [x, z] = tx(g.pos.x, g.pos.z);
      c.fillStyle = !g.alive ? 'rgba(150,150,150,.5)' : g.T.boss ? '#ff3a2a' : g.T.erratic ? '#ff9a3a' : g.T.armored ? '#d8d0c0' : '#e06a5a';
      const s = g.T.boss ? 6 : 3.5;
      c.beginPath(); c.arc(x, z, s, 0, Math.PI * 2); c.fill();
    }
    c.restore();
    // jogador (sempre apontando para cima)
    c.fillStyle = '#fff';
    c.beginPath(); c.moveTo(R, R - 7); c.lineTo(R - 5, R + 5); c.lineTo(R + 5, R + 5); c.closePath(); c.fill();
  }
}
