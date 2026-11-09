import * as THREE from 'three';
import { joinRoom, selfId } from 'trystero/nostr';
import { CFG } from './config.js';
import { buildPlayerModel, SKINS } from './models.js';
import { GIANT_TYPES } from './giants.js';
import { clamp, damp, angleDiff, rand } from './util.js';

const APP_ID = 'attacking-giant-p2p-v1';
const LOBBY_ROOM_ID = '__bastiao_global_lobby__';
const MAX_PLAYERS = 8;

// Configuração WebRTC com múltiplos STUN públicos + TURN gratuito OpenRelay (Metered) para atravessar NAT/Firewall (~8% dos jogadores)
const DEFAULT_TURN_SERVERS = [
  {
    urls: [
      'turn:openrelay.metered.ca:80',
      'turn:openrelay.metered.ca:443',
      'turn:openrelay.metered.ca:443?transport=tcp',
    ],
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
];

const DEFAULT_RTC_CONFIG = {
  iceServers: [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
    { urls: 'stun:stun.cloudflare.com:3478' },
    { urls: 'stun:openrelay.metered.ca:80' },
    ...DEFAULT_TURN_SERVERS,
  ],
};

const UP = new THREE.Vector3(0, 1, 0);
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();

const remoteRopeGeo = new THREE.CylinderGeometry(0.026, 0.026, 1, 5, 1, true).translate(0, 0.5, 0);
const remoteRopeMat = new THREE.MeshBasicMaterial({ color: '#34383d' });
const remoteHookHeadGeo = new THREE.BoxGeometry(0.14, 0.14, 0.28);
const remoteHookHeadMat = new THREE.MeshLambertMaterial({ color: '#9aa4ad' });

// Gera código curto de sala amigável para compartilhar por link (?room=ABC123)
export function generateRoomCode(len = 6) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < len; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

/**
 * Representa um jogador remoto conectado na partida P2P.
 * Renderiza malha 3D completa (com capa da Patrulha), cabos ODM, armas, animações interpoladas e nameplate.
 */
export class RemotePlayer {
  constructor(peerId, scene, effects, info = {}) {
    this.id = peerId;
    this.peerId = peerId;
    this.scene = scene;
    this.effects = effects;
    this.name = info.name || ('Caçador ' + peerId.slice(0, 4).toUpperCase());
    this.skin = info.skin && SKINS[info.skin] ? info.skin : 'vanguarda';
    this.weapon = info.weapon || 'swords';
    this.isHost = !!info.isHost;

    // Cria nameplate flutuante no HUD (#dmgLayer)
    this.labelEl = null;
    if (typeof document !== 'undefined') {
      const layer = document.getElementById('dmgLayer');
      if (layer) {
        const el = document.createElement('div');
        el.className = 'mp-tag';
        el.style.display = 'none';
        el.innerHTML = `<span class="mp-name"></span><div class="mp-hp"><i></i></div>`;
        layer.appendChild(el);
        this.labelEl = el;
      }
    }

    this.pos = new THREE.Vector3(0, 2, 0);
    this.targetPos = new THREE.Vector3(0, 2, 0);
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.targetYaw = 0;
    this.targetPitch = 0;

    this.hp = 100;
    this.hpMax = 100;
    this.alive = true;
    this.onGround = false;
    this.poised = false;
    this.gasOn = false;
    this.slashT = 0;
    this.spinT = 0;
    this.rollT = 0;
    this.slideT = 0;
    this.emoteT = 0;
    this.emoteIdx = 0;
    this.score = 0;
    this.kills = 0;
    this.severs = 0;
    this.ping = 0;
    this.lastSeen = performance.now();
    this.timeSincePacket = 0;
    this.animRun = 0;
    this.time = 0;

    // Estado dos 2 ganchos ODM remotos
    this.hooks = [
      { state: 0, tip: new THREE.Vector3(), rope: new THREE.Mesh(remoteRopeGeo, remoteRopeMat), head: new THREE.Mesh(remoteHookHeadGeo, remoteHookHeadMat) },
      { state: 0, tip: new THREE.Vector3(), rope: new THREE.Mesh(remoteRopeGeo, remoteRopeMat), head: new THREE.Mesh(remoteHookHeadGeo, remoteHookHeadMat) },
    ];
    for (const h of this.hooks) {
      h.rope.visible = false;
      h.rope.frustumCulled = false;
      h.head.visible = false;
      this.scene.add(h.rope, h.head);
    }

    this.buildModel();
  }

  buildModel() {
    if (this.model) this.scene.remove(this.model.group);
    this.model = buildPlayerModel(this.skin);
    this.model.group.scale.setScalar(0.9);
    this.scene.add(this.model.group);
  }

  setSkin(skinKey) {
    if (!SKINS[skinKey] || this.skin === skinKey) return;
    this.skin = skinKey;
    this.buildModel();
  }

  applyState(d) {
    this.lastSeen = performance.now();
    this.timeSincePacket = 0;
    if (d.n && d.n !== this.name) this.name = String(d.n).slice(0, 18);
    if (d.sk && d.sk !== this.skin) this.setSkin(d.sk);
    if (d.wp) this.weapon = d.wp;

    if (Array.isArray(d.p) && d.p.length === 3) {
      const nx = +d.p[0] || 0, ny = +d.p[1] || 0, nz = +d.p[2] || 0;
      // Se teleportou longe (spawn/reset), cola na hora
      if (this.pos.distanceToSquared(_v1.set(nx, ny, nz)) > 1600) {
        this.pos.set(nx, ny, nz);
      }
      this.targetPos.set(nx, ny, nz);
    }
    if (Array.isArray(d.v) && d.v.length === 3) {
      this.vel.set(+d.v[0] || 0, +d.v[1] || 0, +d.v[2] || 0);
    }
    if (typeof d.y === 'number') this.targetYaw = d.y;
    if (typeof d.pi === 'number') this.targetPitch = d.pi;
    if (typeof d.hp === 'number') this.hp = d.hp;
    if (typeof d.sc === 'number') this.score = d.sc;
    if (typeof d.kl === 'number') this.kills = d.kl;
    if (typeof d.sv === 'number') this.severs = d.sv;

    // Bitmask de flags: 1=alive, 2=onGround, 4=poised, 8=gasOn, 16=slash, 32=spin, 64=roll, 128=slide, 256=emote
    if (typeof d.f === 'number') {
      const f = d.f;
      this.alive = !!(f & 1);
      this.onGround = !!(f & 2);
      this.poised = !!(f & 4);
      this.gasOn = !!(f & 8);
      if (f & 16) this.slashT = Math.max(this.slashT, 0.22);
      if (f & 32) this.spinT = Math.max(this.spinT, 0.34);
      if (f & 64) this.rollT = Math.max(this.rollT, 0.40);
      if (f & 128) this.slideT = Math.max(this.slideT, 0.35);
      if (f & 256) {
        this.emoteT = Math.max(this.emoteT, 0.5);
        this.emoteIdx = d.em || 0;
      }
    }

    // Ganchos ODM: d.hk = [stateL, lx, ly, lz, stateR, rx, ry, rz]
    if (Array.isArray(d.hk) && d.hk.length >= 8) {
      this.hooks[0].state = d.hk[0] | 0;
      this.hooks[0].tip.set(+d.hk[1] || 0, +d.hk[2] || 0, +d.hk[3] || 0);
      this.hooks[1].state = d.hk[4] | 0;
      this.hooks[1].tip.set(+d.hk[5] || 0, +d.hk[6] || 0, +d.hk[7] || 0);
    }
  }

  update(dt) {
    this.time += dt;
    this.timeSincePacket += dt;
    this.slashT = Math.max(0, this.slashT - dt);
    this.spinT = Math.max(0, this.spinT - dt);
    this.rollT = Math.max(0, this.rollT - dt);
    this.slideT = Math.max(0, this.slideT - dt);
    this.emoteT = Math.max(0, this.emoteT - dt);

    // Extrapolação curta por velocidade (até 110ms) + interpolação suave
    const extrap = Math.min(0.11, this.timeSincePacket);
    _v1.copy(this.targetPos).addScaledVector(this.vel, extrap);
    this.pos.lerp(_v1, Math.min(1, dt * 16));

    const dy = angleDiff(this.targetYaw, this.yaw);
    this.yaw += dy * Math.min(1, dt * 16);
    this.pitch = damp(this.pitch, this.targetPitch, 16, dt);

    const M = this.model;
    M.group.visible = this.alive;
    if (!this.alive) {
      for (const h of this.hooks) { h.rope.visible = false; h.head.visible = false; }
      return;
    }

    M.group.position.set(this.pos.x, this.pos.y + 0.32, this.pos.z);
    const sp = this.vel.length();
    const horiz = Math.hypot(this.vel.x, this.vel.z);
    const cp = Math.cos(this.pitch);
    _v2.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);

    let yawT;
    if (this.onGround && horiz > 1) yawT = Math.atan2(this.vel.x, this.vel.z);
    else if (!this.onGround && sp > 6) yawT = Math.atan2(this.vel.x, this.vel.z);
    else yawT = Math.atan2(_v2.x, _v2.z);
    if (this.poised || this.slashT > 0) yawT = Math.atan2(_v2.x, _v2.z);

    let mdy = angleDiff(yawT, M.group.rotation.y);
    M.group.rotation.y += mdy * Math.min(1, dt * 12);
    if (this.spinT > 0) M.group.rotation.y += (1 - this.spinT / 0.36) * Math.PI * 4;

    const air = !this.onGround;
    const sliding = this.onGround && this.slideT > 0 && horiz > CFG.runSpeed * 0.8;
    const lean = sliding ? -0.18 : (air ? clamp(sp / 34, 0, 1) * 0.88 : clamp(horiz / CFG.runSpeed, 0, 1) * 0.16);
    const bankZ = clamp(-mdy * 0.85, -0.62, 0.62);
    M.root.rotation.x = damp(M.root.rotation.x, lean, 7, dt);
    M.root.rotation.z = damp(M.root.rotation.z, bankZ, 6, dt);
    if (this.rollT > 0) M.root.rotation.x = (1 - this.rollT / 0.45) * Math.PI * 2;

    this.animRun += dt * horiz * 1.42;
    const run = (this.onGround && !sliding) ? clamp(horiz / CFG.runSpeed, 0, 1) : 0;
    const s = Math.sin(this.animRun);

    let legLX = air ? -0.52 : -s * 0.9 * run;
    let legRX = air ? -0.22 : s * 0.9 * run;
    let shinLX = air ? 0.95 : Math.max(0, s) * 1.12 * run;
    let shinRX = air ? 0.52 : Math.max(0, -s) * 1.12 * run;
    if (sliding) {
      legLX = -0.95; shinLX = 1.52;
      legRX = -0.36; shinRX = 1.18;
    }
    M.legL.rotation.x = damp(M.legL.rotation.x, legLX, 12, dt);
    M.legR.rotation.x = damp(M.legR.rotation.x, legRX, 12, dt);
    M.shinL.rotation.x = damp(M.shinL.rotation.x, shinLX, 12, dt);
    M.shinR.rotation.x = damp(M.shinR.rotation.x, shinRX, 12, dt);

    let aL = -0.28, aR = -0.28, zL = 0.24, zR = -0.24, fL = -0.58, fR = -0.58;
    if (this.poised) {
      if (this.weapon === 'swords') { aL = -2.18; aR = -2.18; zL = 0.62; zR = -0.62; fL = -0.38; fR = -0.38; }
      else { aL = -1.55; aR = -1.55; zL = 0.18; zR = -0.18; fL = -0.1; fR = -0.1; }
    }
    if (this.slashT > 0) {
      const k = clamp(this.slashT / 0.24, 0, 1);
      const swing = 1 - k;
      aL = aR = -1.75 + swing * 2.55;
      zL = 0.92 * k - 0.25 * swing;
      zR = -0.92 * k + 0.25 * swing;
      fL = fR = -0.18;
    } else if (!air && !this.poised) {
      aL += s * 0.62 * run;
      aR -= s * 0.62 * run;
    }
    if (this.emoteT > 0) {
      if (this.emoteIdx === 0) { aR = -1.58; zR = 0.76; fR = -1.55; aL = 0.32; zL = -0.12; fL = -1.25; }
      else if (this.emoteIdx === 1) { aR = -2.9; zR = -0.4 + Math.sin(this.time * 14) * 0.5; fR = -0.3; }
      else if (this.emoteIdx === 2) { aL = -2.85; aR = -2.85; zL = 0.45; zR = -0.45; fL = -0.2; fR = -0.2; }
    }

    M.armL.rotation.x = damp(M.armL.rotation.x, aL, 15, dt);
    M.armR.rotation.x = damp(M.armR.rotation.x, aR, 15, dt);
    M.armL.rotation.z = damp(M.armL.rotation.z, zL, 14, dt);
    M.armR.rotation.z = damp(M.armR.rotation.z, zR, 14, dt);
    M.foreL.rotation.x = damp(M.foreL.rotation.x, fL, 14, dt);
    M.foreR.rotation.x = damp(M.foreR.rotation.x, fR, 14, dt);

    M.bladeL.visible = M.bladeR.visible = this.weapon === 'swords';
    M.apgL.visible = M.apgR.visible = this.weapon === 'apg';
    M.spearL.visible = M.spearR.visible = this.weapon === 'spears';

    const cf = clamp(sp / 30, 0, 1);
    M.cape.rotation.x = damp(M.cape.rotation.x, cf * 1.1 + Math.sin(this.time * 14) * 0.08 * cf, 8, dt);
    M.cape2.rotation.x = damp(M.cape2.rotation.x, cf * 0.5 + Math.sin(this.time * 17 + 1) * 0.15 * cf, 8, dt);

    M.group.updateMatrixWorld(true);

    // Jato de gás ODM do jogador remoto
    if (this.gasOn && this.effects) {
      const nozzlePos = M.nozzle.getWorldPosition(_v3);
      const jetDir = sp > 0.5 ? _v1.copy(this.vel).divideScalar(sp) : _v2;
      if (Math.random() < dt * 28) this.effects.gasJet(nozzlePos, jetDir, 0.8);
    }

    // Atualiza cabos ODM remotos
    for (let i = 0; i < 2; i++) {
      const h = this.hooks[i];
      if (h.state === 0) {
        h.rope.visible = false;
        h.head.visible = false;
        continue;
      }
      const launcher = i === 0 ? M.launcherL : M.launcherR;
      const start = launcher.getWorldPosition(_v1);
      const d = _v2.copy(h.tip).sub(start);
      const L = d.length();
      if (L < 0.05) {
        h.rope.visible = false;
        h.head.visible = false;
        continue;
      }
      h.rope.visible = true;
      h.rope.position.copy(start);
      h.rope.quaternion.setFromUnitVectors(UP, d.divideScalar(L));
      h.rope.scale.set(1, L, 1);
      h.head.visible = true;
      h.head.position.copy(h.tip);
      h.head.lookAt(start);
    }
  }

  dispose() {
    if (this.model) {
      this.scene.remove(this.model.group);
    }
    for (const h of this.hooks) {
      this.scene.remove(h.rope, h.head);
    }
    if (this.labelEl) {
      this.labelEl.remove();
      this.labelEl = null;
    }
  }
}

/**
 * Canal híbrido P2P:
 * - Usa Trystero (WebRTC DataChannels via Nostr relays + STUN/TURN) para conexões na internet / GitHub Pages
 * - E também um BroadcastChannel local de baixa latência para abas no mesmo navegador (garante descoberta instantânea local e em testes)
 * - Desduplica mensagens por (peerId, seq)
 */
class HybridRoomTransport {
  constructor(config, roomId, handlers) {
    this.roomId = roomId;
    this.handlers = handlers;
    this.actions = new Map();
    this.seenSeq = new Map();
    this.bcPeers = new Set();
    this.seq = 1;
    this.closed = false;

    // 1. Trystero WebRTC Room (serverless Nostr signaling + TURN)
    this.trysteroRoom = joinRoom(config, roomId, {
      onJoinError: (err) => {
        if (handlers.onError) handlers.onError(err);
      },
    });

    this.trysteroRoom.onPeerJoin = (peerId) => {
      if (this.closed || peerId === selfId) return;
      handlers.onPeerJoin && handlers.onPeerJoin(peerId, 'webrtc');
    };
    this.trysteroRoom.onPeerLeave = (peerId) => {
      if (this.closed) return;
      if (!this.bcPeers.has(peerId)) {
        handlers.onPeerLeave && handlers.onPeerLeave(peerId);
      }
    };

    // 2. BroadcastChannel local (mesmo navegador / abas locais)
    this.bc = null;
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        this.bc = new BroadcastChannel(`bastiao_p2p_${roomId}`);
        this.bc.onmessage = (ev) => this.onBcMessage(ev.data);
        this.bc.postMessage({ t: 'join', from: selfId });
        this.bcTimer = setInterval(() => {
          if (!this.closed && this.bc) this.bc.postMessage({ t: 'hb', from: selfId });
        }, 2000);
      } catch {
        this.bc = null;
      }
    }
  }

  onBcMessage(msg) {
    if (this.closed || !msg || msg.from === selfId) return;
    const peerId = msg.from;
    if (msg.t === 'join' || msg.t === 'hb') {
      if (!this.bcPeers.has(peerId)) {
        this.bcPeers.add(peerId);
        this.handlers.onPeerJoin && this.handlers.onPeerJoin(peerId, 'local');
      }
      if (msg.t === 'join' && this.bc) {
        this.bc.postMessage({ t: 'hb', from: selfId });
      }
      return;
    }
    if (msg.t === 'leave') {
      this.bcPeers.delete(peerId);
      const webrtcPeers = this.trysteroRoom ? this.trysteroRoom.getPeers() : {};
      if (!webrtcPeers[peerId]) {
        this.handlers.onPeerLeave && this.handlers.onPeerLeave(peerId);
      }
      return;
    }
    if (msg.t === 'act') {
      if (msg.target && msg.target !== selfId && (!Array.isArray(msg.target) || !msg.target.includes(selfId))) return;
      this.deliver(msg.ns, msg.data, peerId, msg.seq);
    }
  }

  deliver(ns, data, peerId, seq) {
    if (this.closed || peerId === selfId) return;
    if (seq) {
      let set = this.seenSeq.get(peerId);
      if (!set) { set = new Set(); this.seenSeq.set(peerId, set); }
      if (set.has(seq)) return;
      set.add(seq);
      if (set.size > 300) {
        const first = set.values().next().value;
        set.delete(first);
      }
    }
    const cb = this.actions.get(ns);
    if (cb) cb(data, peerId);
  }

  registerAction(ns, onMsg) {
    this.actions.set(ns, onMsg);
    const act = this.trysteroRoom.makeAction(ns, {
      onMessage: (wrapper, ctx) => {
        if (!wrapper || typeof wrapper !== 'object') return;
        this.deliver(ns, wrapper.d, ctx.peerId, wrapper.s);
      },
    });
    return (data, target = null) => {
      if (this.closed) return;
      const s = this.seq++;
      const payload = { d: data, s };
      try {
        const webrtcPeers = this.trysteroRoom ? this.trysteroRoom.getPeers() : {};
        if (target) {
          const validTargets = Array.isArray(target)
            ? target.filter((id) => !!webrtcPeers[id])
            : (webrtcPeers[target] ? [target] : []);
          if (validTargets.length > 0) {
            act.send(payload, { target: validTargets }).catch(() => {});
          }
        } else if (Object.keys(webrtcPeers).length > 0) {
          act.send(payload).catch(() => {});
        }
      } catch {
        // Canal WebRTC ainda negociando
      }
      if (this.bc) {
        try {
          this.bc.postMessage({ t: 'act', ns, data, from: selfId, target, seq: s });
        } catch { /* ignore */ }
      }
    };
  }

  async pingPeer(peerId) {
    try {
      const webrtcPeers = this.trysteroRoom.getPeers();
      if (webrtcPeers && webrtcPeers[peerId]) {
        return await this.trysteroRoom.ping(peerId);
      }
    } catch { /* fallback */ }
    return this.bcPeers.has(peerId) ? 1 : 0;
  }

  getConnectedPeerIds() {
    const webrtc = this.trysteroRoom ? Object.keys(this.trysteroRoom.getPeers()) : [];
    return [...new Set([...webrtc, ...this.bcPeers])].filter((id) => id !== selfId);
  }

  leave() {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.bcTimer);
    if (this.bc) {
      try {
        this.bc.postMessage({ t: 'leave', from: selfId });
        this.bc.close();
      } catch { /* ignore */ }
      this.bc = null;
    }
    if (this.trysteroRoom) {
      this.trysteroRoom.leave().catch(() => {});
      this.trysteroRoom = null;
    }
  }
}

/**
 * Gerenciador de Rede P2P ("Listen Server" em Topologia Estrela com Migração de Host e Lobby Público).
 */
export class NetManager {
  constructor(game) {
    this.game = game;
    this.selfId = selfId;
    this.localId = selfId;
    this.maxPlayers = MAX_PLAYERS;
    this.playerName = localStorage.getItem('bastiao.playerName') || ('Batedor-' + selfId.slice(0, 4).toUpperCase());
    this.customTurnUrl = localStorage.getItem('bastiao.turnUrl') || '';
    this.customTurnUser = localStorage.getItem('bastiao.turnUser') || '';
    this.customTurnPass = localStorage.getItem('bastiao.turnPass') || '';

    this.room = null;
    this.roomId = null;
    this.isPublicRoom = true;
    this.isHost = false;
    this.hostId = null;
    this.hostEpoch = 0;
    this.joinedAt = Date.now();
    this.peerJoinTimes = new Map(); // peerId -> joinedAt

    this.remotes = new Map(); // peerId -> RemotePlayer
    this.senders = {};
    this.syncAccum = 0;
    this.giantSyncAccum = 0;
    this.pingAccum = 0;
    this.lobbyAnnounceAccum = 0;

    // Lobby Global (descoberta de salas abertas sem servidor dedicado)
    this.lobbyTransport = null;
    this.sendLobbyAnnounce = null;
    this.openRooms = new Map(); // roomId -> { code, roomId, hostId, hostName, mode, wave, players, max, maxPlayers, ts }
    this.onUIUpdate = null;
    this.onStatusChange = null;
    this.onLobbyChange = null;
  }

  get active() {
    return !!this.room && !!this.roomId;
  }

  get roomCode() {
    return this.roomId;
  }

  get nickname() {
    return this.playerName;
  }

  set nickname(v) {
    this.setPlayerName(v);
  }

  get customTurn() {
    return {
      url: this.customTurnUrl,
      username: this.customTurnUser,
      credential: this.customTurnPass,
    };
  }

  get lobbyRooms() {
    return this.openRooms;
  }

  get playerCount() {
    return this.active ? 1 + this.remotes.size : 1;
  }

  setPlayerName(name) {
    const clean = (name || '').trim().slice(0, 18) || ('Batedor-' + selfId.slice(0, 4).toUpperCase());
    this.playerName = clean;
    try { localStorage.setItem('bastiao.playerName', clean); } catch { /* ignore */ }
  }

  setNickname(name) {
    this.setPlayerName(name);
  }

  setCustomTurn(url, user, pass) {
    this.customTurnUrl = (url || '').trim();
    this.customTurnUser = (user || '').trim();
    this.customTurnPass = (pass || '').trim();
    try {
      localStorage.setItem('bastiao.turnUrl', this.customTurnUrl);
      localStorage.setItem('bastiao.turnUser', this.customTurnUser);
      localStorage.setItem('bastiao.turnPass', this.customTurnPass);
    } catch { /* ignore */ }
  }

  buildRoomConfig() {
    const turnServers = [...DEFAULT_TURN_SERVERS];
    if (this.customTurnUrl) {
      turnServers.unshift({
        urls: this.customTurnUrl,
        username: this.customTurnUser || undefined,
        credential: this.customTurnPass || undefined,
      });
    }
    return {
      appId: APP_ID,
      relayConfig: { warnOnRelayFailure: false },
      rtcConfig: {
        iceServers: [
          ...DEFAULT_RTC_CONFIG.iceServers,
          ...(this.customTurnUrl ? [turnServers[0]] : []),
        ],
      },
      turnConfig: turnServers,
    };
  }

  // ================= LOBBY PÚBLICO DE SALAS =================
  initLobby() {
    if (this.lobbyTransport) return;
    try {
      this.lobbyTransport = new HybridRoomTransport(this.buildRoomConfig(), LOBBY_ROOM_ID, {
        onPeerJoin: () => {
          // Quando alguém entra no lobby, se somos Host de uma sala pública, anunciamos imediatamente
          if (this.active && this.isHost && this.isPublicRoom) {
            this.broadcastLobbyListing();
          }
        },
        onPeerLeave: () => {},
      });
      this.sendLobbyAnnounce = this.lobbyTransport.registerAction('lob_ann', (data, peerId) => {
        if (!data || !data.roomId) return;
        const cleanCode = String(data.roomId).slice(0, 12);
        if (data.closed) {
          this.openRooms.delete(cleanCode);
        } else {
          this.openRooms.set(cleanCode, {
            code: cleanCode,
            roomId: cleanCode,
            hostId: peerId,
            hostName: String(data.hostName || 'Anfitrião').slice(0, 18),
            mode: data.mode || 'survival',
            wave: data.wave || 1,
            players: clamp(+data.players || 1, 1, MAX_PLAYERS),
            max: MAX_PLAYERS,
            maxPlayers: MAX_PLAYERS,
            ts: Date.now(),
          });
        }
        this.pruneLobbyRooms();
        this.notifyUI();
      });
    } catch (e) {
      console.warn('Falha ao iniciar sala-lobby pública:', e);
    }
  }

  pruneLobbyRooms() {
    const now = Date.now();
    for (const [k, rm] of this.openRooms) {
      if (now - rm.ts > 16000) this.openRooms.delete(k);
    }
  }

  broadcastLobbyListing(closed = false) {
    if (!this.sendLobbyAnnounce || !this.roomId) return;
    this.sendLobbyAnnounce({
      roomId: this.roomId,
      hostName: this.playerName,
      mode: this.game.mode?.key === 'menu' ? 'survival' : (this.game.mode?.key || 'survival'),
      wave: this.game.wave || 1,
      players: this.playerCount,
      closed,
    });
  }

  // ================= CRIAR / ENTRAR EM SALA P2P =================
  createRoom(mode = 'survival', isPublic = true, customCode = '') {
    const code = (customCode || generateRoomCode(6)).toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 12);
    return this.joinMatchRoom(code, { createAsHost: true, mode, isPublic, autoStart: false });
  }

  joinRoomByCode(rawCode, asHost = false) {
    return this.joinMatchRoom(rawCode, { createAsHost: asHost, autoStart: false });
  }

  joinMatchRoom(rawCode, opts = {}) {
    const code = String(rawCode || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 12);
    if (!code) return null;

    if (this.active) this.leaveRoom(false);
    this.initLobby();

    this.roomId = code;
    this.isPublicRoom = opts.isPublic ?? true;
    this.joinedAt = Date.now();
    this.peerJoinTimes.clear();
    this.peerJoinTimes.set(selfId, this.joinedAt);

    // Quem cria a sala começa como Host; quem entra aguarda o anúncio do Host (ou assume se estiver sozinho após 2.2s)
    this.isHost = !!opts.createAsHost;
    this.hostId = this.isHost ? selfId : null;
    this.hostEpoch = this.isHost ? 1 : 0;

    // Atualiza URL com ?room=CODIGO (estilo Jackbox) para compartilhamento fácil
    this.updateUrlParam(code);

    this.room = new HybridRoomTransport(this.buildRoomConfig(), `room_${code}`, {
      onPeerJoin: (peerId) => this.onPeerJoin(peerId),
      onPeerLeave: (peerId) => this.onPeerLeave(peerId),
    });

    this.setupRoomActions();

    if (this.isHost) {
      if (opts.autoStart !== false) {
        const targetMode = opts.mode || (this.game.state === 'playing' ? this.game.mode.key : 'survival');
        if (this.game.state !== 'playing' || opts.mode) {
          this.game.startMode(targetMode);
        }
      }
      this.game.hud.feed(`Sala P2P criada: ${code} (Você é o HOST)`);
      this.broadcastLobbyListing(false);
    } else {
      this.game.hud.feed(`Conectando à sala P2P ${code}...`);
      // Se após 2.2s nenhum Host respondeu na sala, este jogador se torna o Host da sala!
      this.hostClaimTimer = setTimeout(() => {
        if (!this.active || this.hostId) return;
        this.promoteToHost('Sala vazia — você assumiu como HOST');
        if (this.game.state === 'menu') {
          this.game.startMode(opts.mode || 'survival');
        }
      }, 2200);
    }

    this.notifyUI();
    return code;
  }

  setupRoomActions() {
    const R = this.room;

    // 1. Handshake / Metadados da Sala e Eleição de Host
    this.senders.hello = R.registerAction('hello', (data, peerId) => this.onHello(data, peerId));

    // 2. Estado de Movimento do Jogador (18 Hz, Cliente -> Host -> Clientes)
    this.senders.pState = R.registerAction('pState', (data, peerId) => this.onPlayerState(data, peerId));

    // 3. Snapshot de Estado dos Titãs e Onda (15 Hz, Host -> Clientes)
    this.senders.gState = R.registerAction('gState', (data, peerId) => this.onGiantsState(data, peerId));

    // 4. Eventos de Combate (Dano, Abate, Decepação, Projéteis, Sinalizadores, Mudança de Modo)
    this.senders.evt = R.registerAction('evt', (data, peerId) => this.onGameEvent(data, peerId));
  }

  onPeerJoin(peerId) {
    if (this.remotes.size >= MAX_PLAYERS - 1) return;
    if (!this.remotes.has(peerId)) {
      const rp = new RemotePlayer(peerId, this.game.scene, this.game.effects);
      this.remotes.set(peerId, rp);
    }
    // Envia pacote hello com nossas informações e estado de Host
    this.senders.hello({
      name: this.playerName,
      skin: this.game.player.skin,
      weapon: this.game.player.weapon,
      joinedAt: this.joinedAt,
      isHost: this.isHost,
      hostId: this.hostId,
      hostEpoch: this.hostEpoch,
      mode: this.game.mode?.key || 'survival',
      wave: this.game.wave || 1,
      score: this.game.score || 0,
    }, peerId);

    if (this.isHost) {
      // Envia snapshot imediato dos Titãs para o novo jogador
      this.broadcastGiantsSnapshot(peerId);
      this.broadcastLobbyListing(false);
    }
    this.notifyUI();
  }

  onPeerLeave(peerId) {
    const rp = this.remotes.get(peerId);
    const leftName = rp ? rp.name : peerId.slice(0, 5);
    if (rp) {
      rp.dispose();
      this.remotes.delete(peerId);
    }
    this.peerJoinTimes.delete(peerId);
    this.game.hud.feed(`${leftName} saiu da sala`);

    // Migração automática de Host se o Host atual caiu/saiu!
    if (peerId === this.hostId) {
      this.electNewHostAfterDisconnect();
    } else if (this.isHost) {
      this.broadcastLobbyListing(false);
    }
    this.notifyUI();
  }

  onHello(data, peerId) {
    if (!data) return;
    let rp = this.remotes.get(peerId);
    if (!rp) {
      if (this.remotes.size >= MAX_PLAYERS - 1) return;
      rp = new RemotePlayer(peerId, this.game.scene, this.game.effects, data);
      this.remotes.set(peerId, rp);
      this.game.hud.feed(`${rp.name} entrou na sala!`);
      this.game.audio.ui();
    } else {
      if (data.name) rp.name = String(data.name).slice(0, 18);
      if (data.skin) rp.setSkin(data.skin);
      if (data.weapon) rp.weapon = data.weapon;
    }
    if (typeof data.joinedAt === 'number') {
      this.peerJoinTimes.set(peerId, data.joinedAt);
    }

    // Resolução de quem é o Host (Listen Server)
    if (data.isHost) {
      clearTimeout(this.hostClaimTimer);
      if (!this.isHost) {
        this.hostId = peerId;
        this.hostEpoch = data.hostEpoch || 1;
        rp.isHost = true;
        // Sincroniza modo de jogo com o Host
        const hostMode = data.mode && data.mode !== 'menu' ? data.mode : 'survival';
        if (this.game.state === 'menu' || this.game.mode.key !== hostMode) {
          this.game.startMode(hostMode, true);
        }
        if (typeof data.wave === 'number') this.game.wave = data.wave;
      } else if (peerId !== selfId) {
        // Caso raro de colisão de dois Hosts simultâneos: vence quem entrou primeiro (ou menor ID)
        const myTime = this.joinedAt;
        const theirTime = data.joinedAt || Date.now();
        if (theirTime < myTime || (theirTime === myTime && peerId < selfId)) {
          this.isHost = false;
          this.hostId = peerId;
          this.hostEpoch = Math.max(this.hostEpoch, data.hostEpoch || 1);
          rp.isHost = true;
        } else {
          rp.isHost = false;
          this.senders.hello({
            name: this.playerName,
            skin: this.game.player.skin,
            weapon: this.game.player.weapon,
            joinedAt: this.joinedAt,
            isHost: true,
            hostId: selfId,
            hostEpoch: ++this.hostEpoch,
            mode: this.game.mode?.key || 'survival',
            wave: this.game.wave || 1,
          }, peerId);
        }
      }
    }
    this.notifyUI();
  }

  // ================= MIGRAÇÃO AUTOMÁTICA DE HOST =================
  electNewHostAfterDisconnect() {
    const candidates = [selfId, ...this.remotes.keys()];
    candidates.sort((a, b) => {
      const ta = this.peerJoinTimes.get(a) ?? Infinity;
      const tb = this.peerJoinTimes.get(b) ?? Infinity;
      if (Math.abs(ta - tb) > 100) return ta - tb;
      return a < b ? -1 : a > b ? 1 : 0;
    });
    const winner = candidates[0];
    if (winner === selfId) {
      this.promoteToHost('Host desconectou — você assumiu como novo HOST!');
    } else {
      this.isHost = false;
      this.hostId = winner;
      for (const [id, r] of this.remotes) r.isHost = (id === winner);
      const newHostRp = this.remotes.get(winner);
      this.game.hud.feed(`Migração de Host: ${newHostRp ? newHostRp.name : winner.slice(0, 5)} agora é o HOST`);
    }
    this.notifyUI();
  }

  promoteToHost(reasonMsg) {
    this.isHost = true;
    this.hostId = selfId;
    this.hostEpoch++;
    for (const r of this.remotes.values()) r.isHost = false;
    if (reasonMsg) {
      this.game.hud.feed(reasonMsg);
      this.game.hud.flashMsg('VOCÊ AGORA É O HOST DA SALA', '#5dff7a', 1.8);
    }
    // Reativa IA de perseguição nos Titãs vivos restantes
    for (const g of this.game.giants.giants) {
      if (g.alive && !g.T.dummy && this.game.mode?.key === 'survival') {
        g.alwaysChase = true;
        g.state = 'chase';
      }
    }
    if (this.senders.hello) {
      this.senders.hello({
        name: this.playerName,
        skin: this.game.player.skin,
        weapon: this.game.player.weapon,
        joinedAt: this.joinedAt,
        isHost: true,
        hostId: selfId,
        hostEpoch: this.hostEpoch,
        mode: this.game.mode?.key || 'survival',
        wave: this.game.wave || 1,
      });
    }
    this.broadcastLobbyListing(false);
    this.notifyUI();
  }

  // ================= SINCRONIZAÇÃO DE JOGADORES (18 Hz) =================
  serializeLocalPlayer(includeMeta = false) {
    const P = this.game.player;
    const h0 = P.hooks[0], h1 = P.hooks[1];
    const st0 = h0.state === 'attached' ? 2 : h0.state === 'flying' ? 1 : 0;
    const st1 = h1.state === 'attached' ? 2 : h1.state === 'flying' ? 1 : 0;
    const gasOn = P.alive && !P.grabbedBy && P.gas > 0 && (!!P.burst || P.gasFlow > 0 || !!P.lunge);
    let flags = 0;
    if (P.alive) flags |= 1;
    if (P.onGround) flags |= 2;
    if (P.poised) flags |= 4;
    if (gasOn) flags |= 8;
    if (P.slashT > 0) flags |= 16;
    if (P.spinT > 0) flags |= 32;
    if (P.rollT > 0) flags |= 64;
    if (P.slideT > 0) flags |= 128;
    if (P.emoteT > 0) flags |= 256;

    const pkt = {
      p: [+P.pos.x.toFixed(2), +P.pos.y.toFixed(2), +P.pos.z.toFixed(2)],
      v: [+P.vel.x.toFixed(1), +P.vel.y.toFixed(1), +P.vel.z.toFixed(1)],
      y: +P.yaw.toFixed(3),
      pi: +P.pitch.toFixed(2),
      f: flags,
      hp: Math.round(P.hp),
      wp: P.weapon,
      hk: [
        st0, +h0.tip.x.toFixed(1), +h0.tip.y.toFixed(1), +h0.tip.z.toFixed(1),
        st1, +h1.tip.x.toFixed(1), +h1.tip.y.toFixed(1), +h1.tip.z.toFixed(1),
      ],
    };
    if (P.emoteT > 0) pkt.em = P.emoteIdx;
    if (includeMeta) {
      pkt.n = this.playerName;
      pkt.sk = P.skin;
      pkt.sc = Math.round(this.game.score || 0);
      pkt.kl = this.game.stats?.kills || 0;
      pkt.sv = this.game.stats?.severs || 0;
    }
    return pkt;
  }

  onPlayerState(data, fromPeerId) {
    if (!data) return;
    // Se o pacote foi retransmitido pelo Host em topologia estrela, usa data.id como autor original
    const originId = data.id || fromPeerId;
    if (originId === selfId) return;

    let rp = this.remotes.get(originId);
    if (!rp) {
      if (this.remotes.size >= MAX_PLAYERS - 1) return;
      rp = new RemotePlayer(originId, this.game.scene, this.game.effects, { name: data.n, skin: data.sk, weapon: data.wp });
      this.remotes.set(originId, rp);
      this.notifyUI();
    }
    rp.applyState(data);

    // Topologia em Estrela: se somos o Host e recebemos do cliente A, repassamos para os outros clientes da sala
    if (this.isHost && !data.relayed && this.remotes.size > 1) {
      const others = [...this.remotes.keys()].filter((id) => id !== originId);
      if (others.length > 0) {
        this.senders.pState({ ...data, id: originId, relayed: 1 }, others);
      }
    }
  }

  // ================= SINCRONIZAÇÃO DOS TITÃS (HOST -> CLIENTES, 15 Hz) =================
  broadcastGiantsSnapshot(targetPeer = null) {
    if (!this.active || !this.isHost || !this.senders.gState) return;
    const list = [];
    for (const g of this.game.giants.giants) {
      let limbsMask = 0;
      if (g.limbs.armL.sev) limbsMask |= 1;
      if (g.limbs.armR.sev) limbsMask |= 2;
      if (g.limbs.legL.sev) limbsMask |= 4;
      if (g.limbs.legR.sev) limbsMask |= 8;
      if (g.limbs.eyes.sev) limbsMask |= 16;

      list.push({
        id: g.id,
        tk: g.typeKey,
        h: +g.H.toFixed(2),
        x: +g.pos.x.toFixed(2),
        y: +g.pos.y.toFixed(2),
        z: +g.pos.z.toFixed(2),
        hd: +g.heading.toFixed(3),
        st: g.state,
        al: g.alive ? 1 : 0,
        nh: Math.round(g.napeHP),
        ah: Math.round(g.armorHP),
        lb: limbsMask,
        dn: +g.downed.toFixed(2),
        ly: +g.lookYaw.toFixed(2),
        lp: +g.lookPitch.toFixed(2),
      });
    }
    this.senders.gState({
      e: this.hostEpoch,
      m: this.game.mode?.key || 'survival',
      w: this.game.wave || 0,
      ws: this.game.waveSpawning ? 1 : 0,
      g: list,
    }, targetPeer);
  }

  onGiantsState(data, peerId) {
    if (!data || this.isHost) return;
    if (this.hostId && peerId !== this.hostId && (data.e || 0) < this.hostEpoch) return;
    if (!this.hostId || (data.e || 0) > this.hostEpoch) {
      this.hostId = peerId;
      this.hostEpoch = data.e || 1;
      clearTimeout(this.hostClaimTimer);
    }

    // Sincroniza modo e onda com o Host
    if (data.m && data.m !== 'menu' && (this.game.state === 'menu' || this.game.mode.key !== data.m)) {
      this.game.startMode(data.m, true);
    }
    if (typeof data.w === 'number' && data.w !== this.game.wave) {
      this.game.wave = data.w;
      this.game.waveSpawning = !!data.ws;
      this.game.updateWaveSub();
    } else if (typeof data.ws === 'number') {
      this.game.waveSpawning = !!data.ws;
      this.game.updateWaveSub();
    }

    if (Array.isArray(data.g)) {
      this.game.giants.applyNetworkSnapshot(data.g, this.game.ctx);
      if (this.game.mode?.key === 'survival' && !this.game.waveSpawning) {
        this.game.updateWaveSub();
      }
    }
  }

  // ================= EVENTOS DE COMBATE E EFEITOS =================
  sendHitRequest(giant, zone, dmg, hitPoint) {
    if (!this.active || this.isHost || !this.senders.evt) return;
    this.senders.evt({
      k: 'hitReq',
      gid: giant.id,
      zone,
      dmg,
      byName: this.playerName,
      p: hitPoint ? [+hitPoint.x.toFixed(1), +hitPoint.y.toFixed(1), +hitPoint.z.toFixed(1)] : [0, 0, 0],
    }, this.hostId || null);
  }

  broadcastHitConfirmed(giant, zone, dmgOrRes, resOrDmg, hitPoint, attackerId, attackerName) {
    if (!this.active || !this.isHost || !this.senders.evt) return;
    const isResFirst = dmgOrRes && typeof dmgOrRes === 'object';
    const res = isResFirst ? dmgOrRes : (resOrDmg || { r: 'nothing' });
    const dmg = isResFirst ? resOrDmg : dmgOrRes;
    this.senders.evt({
      k: 'hitRes',
      gid: giant.id,
      gName: giant.T?.name || 'Gigante',
      gScore: giant.T?.score || 100,
      zone,
      r: res.r,
      limb: res.limb || zone,
      dmg,
      byId: attackerId || selfId,
      byName: attackerName || this.playerName,
      p: hitPoint ? [+hitPoint.x.toFixed(1), +hitPoint.y.toFixed(1), +hitPoint.z.toFixed(1)] : [0, 0, 0],
    });
  }

  broadcastActionFx(fxKind, pos, dirOrVel, extra = {}) {
    if (!this.active || !this.senders.evt) return;
    this.senders.evt({
      k: 'fx',
      fx: fxKind,
      p: pos ? [+pos.x.toFixed(1), +pos.y.toFixed(1), +pos.z.toFixed(1)] : [0, 0, 0],
      v: dirOrVel ? [+dirOrVel.x.toFixed(1), +dirOrVel.y.toFixed(1), +dirOrVel.z.toFixed(1)] : [0, 0, 0],
      ...extra,
    });
  }

  broadcastWaveEvent(evOrObj, wave, boss = false) {
    if (!this.active || !this.isHost || !this.senders.evt) return;
    if (evOrObj && typeof evOrObj === 'object') {
      if (evOrObj.ev === 'mode') {
        this.senders.evt({ k: 'mode', mode: evOrObj.mode, wave: evOrObj.wave });
      } else {
        this.senders.evt({ k: 'wave', ev: evOrObj.ev, wave: evOrObj.wave, boss: !!evOrObj.boss });
      }
      return;
    }
    this.senders.evt({ k: 'wave', ev: evOrObj, wave, boss });
  }

  broadcastModeChange(modeKey) {
    if (!this.active || !this.isHost || !this.senders.evt) return;
    this.senders.evt({ k: 'mode', mode: modeKey });
  }

  onGameEvent(data, peerId) {
    if (!data || !data.k) return;
    const G = this.game;

    // 1. Cliente pedindo ao Host para validar e aplicar um golpe em um Titã
    if (data.k === 'hitReq' && this.isHost) {
      const g = G.giants.getById(data.gid);
      if (!g || !g.alive) return;
      const mesh = this.findZoneMesh(g, data.zone);
      const res = g.receiveHit(data.zone, data.dmg, mesh || g.m.nape, G.ctx);
      if (res.r !== 'nothing') {
        const pt = Array.isArray(data.p) ? new THREE.Vector3(data.p[0], data.p[1], data.p[2]) : g.pos;
        const attackerName = data.byName || this.remotes.get(peerId)?.name || 'Aliado';
        if (res.r === 'kill') {
          G.hud.feed(`★ ${attackerName} abateu ${g.T.name}!`);
          G.audio.kill();
        } else if (res.r === 'sever') {
          G.hud.feed(`${attackerName} decepou membro de ${g.T.name}`);
        } else if (res.r === 'armorbreak') {
          G.hud.feed(`${attackerName} quebrou a couraça do Blindado!`);
        }
        this.broadcastHitConfirmed(g, data.zone, data.dmg, res, pt, peerId, attackerName);
        this.broadcastGiantsSnapshot();
      }
      return;
    }

    // 2. Host confirmou acerto/abate em um Titã
    if (data.k === 'hitRes' && !this.isHost) {
      const g = G.giants.getById(data.gid);
      const pt = Array.isArray(data.p) ? new THREE.Vector3(data.p[0], data.p[1], data.p[2]) : (g ? g.pos : _v1.set(0, 5, 0));
      if (g) {
        g.flash = 0.15;
        if (data.r === 'kill' && g.alive) {
          G.effects.blood(pt, null, 38, g.s * 0.7);
          g.kill(G.ctx);
        } else if (data.r === 'sever' && g.limbs[data.limb] && !g.limbs[data.limb].sev) {
          g.sever(data.limb, G.ctx);
        } else if (data.r === 'armorbreak' && g.m.armor && g.m.armor[0]) {
          const plate = g.m.armor[0];
          if (plate.visible) {
            G.effects.addDebris(plate, new THREE.Vector3(0, 4, 0), g.s);
            plate.visible = false;
            plate.userData.zone = 'body';
          }
          g.armorHP = 0;
        } else if (data.r === 'blind' && !g.limbs.eyes.sev) {
          g.limbs.eyes.sev = true;
          g.limbs.eyes.t = 9;
          g.blind = 1;
          G.effects.blood(pt, null, 14, g.s * 0.5);
        }
      }
      if (data.byId === selfId) {
        // Foi nosso próprio golpe confirmado pelo Host!
        const fakeGiant = g || { T: { name: data.gName || 'Gigante', score: data.gScore || 100 } };
        G.onPlayerHit({ r: data.r, limb: data.limb, dmg: data.dmg, need: 100 }, { giant: fakeGiant }, data.dmg, pt, true);
        G.player.stress = Math.max(0, G.player.stress - (data.r === 'kill' ? 33 : 6));
      } else if (data.r === 'kill') {
        G.hud.feed(`★ ${data.byName || 'Aliado'} abateu ${data.gName || 'Gigante'}!`);
        G.audio.kill();
      }
      return;
    }

    // 3. Eventos de Onda (Início de Onda / Onda Limpa)
    if (data.k === 'wave' && !this.isHost) {
      G.wave = data.wave || G.wave;
      if (data.ev === 'prep') {
        G.waveSpawning = true;
        G.hud.setWave(`ONDA ${G.wave}`, data.boss ? 'UM COLOSSO SE APROXIMA' : 'Prepare-se');
      } else if (data.ev === 'start') {
        G.waveSpawning = false;
        G.hud.bigMsg(`ONDA ${G.wave}`, data.boss ? 'O COLOSSO' : 'Eles atravessaram a brecha');
        G.audio.waveStart();
        G.updateWaveSub();
      } else if (data.ev === 'clear') {
        G.score += 250 * G.wave;
        G.hud.bigMsg('ONDA LIMPA', `+${250 * G.wave} pontos`);
        G.audio.resupply();
        // Se o jogador local tinha caído na onda, revive para a próxima onda!
        if (!G.player.alive) {
          G.player.reset(new THREE.Vector3(-20 + rand(-8, 8), 1, rand(-8, 8)));
          G.hud.flashMsg('REVIVIDO PELA EQUIPE!', '#5dff7a', 2.0);
        }
        setTimeout(() => {
          if (G.state === 'playing') G.showUpgrades();
        }, 1600);
      }
      return;
    }

    // 4. Mudança de Modo pelo Host
    if (data.k === 'mode' && !this.isHost && data.mode) {
      G.startMode(data.mode, true);
      return;
    }

    // 5. Efeitos visuais/sonoros de outros jogadores (tiros APG, Lança do Trovão, Sinalizadores)
    if (data.k === 'fx') {
      const p = new THREE.Vector3(data.p[0], data.p[1], data.p[2]);
      const v = new THREE.Vector3(data.v[0], data.v[1], data.v[2]);
      const dbl = !!(data.double ?? data.dbl);
      if (data.fx === 'flare') {
        G.spawnFlare(data.flareKind || data.kind || 'smoke', p, v, true);
      } else if (data.fx === 'apg') {
        G.effects.sparks(p, dbl ? 18 : 10);
        G.effects.puff(p, v.clone().multiplyScalar(6), '#e6e0d6', 0.45, 0.4);
        G.audio.apgShot(dbl);
      } else if (data.fx === 'spearExplode' || data.fx === 'spearBoom') {
        G.audio.spearExplode();
        G.effects.sparks(p, 45);
        G.effects.bigSteam(p, 2.0, 10);
      }
      if (this.isHost && !data.relayed && this.remotes.size > 1) {
        const others = [...this.remotes.keys()].filter((id) => id !== peerId);
        if (others.length > 0) this.senders.evt({ ...data, relayed: 1 }, others);
      }
    }
  }

  findZoneMesh(giant, zone) {
    if (zone === 'nape') return (giant.T.armored && giant.armorHP > 0 && giant.m.armor[0]) ? giant.m.armor[0] : giant.m.nape;
    if (zone === 'eyes') return giant.m.eyes.children[0] || giant.m.head;
    if (giant.zones[zone] && giant.zones[zone][0]) return giant.zones[zone][0];
    return giant.m.nape;
  }

  // Retorna a lista de todos os jogadores vivos na partida (para a IA dos Titãs no Host perseguir o mais próximo)
  getAllAlivePlayers() {
    const list = [];
    if (this.game.player && this.game.player.alive) {
      list.push(this.game.player);
    }
    for (const rp of this.remotes.values()) {
      if (rp.alive) list.push(rp);
    }
    return list;
  }

  // ================= LOOP DE ATUALIZAÇÃO DE REDE =================
  update(dt) {
    this.lobbyAnnounceAccum += dt;
    if (this.lobbyAnnounceAccum >= 4.5) {
      this.lobbyAnnounceAccum = 0;
      this.pruneLobbyRooms();
      if (this.active && this.isHost && this.isPublicRoom) {
        this.broadcastLobbyListing(false);
      }
    }

    if (!this.active) return;

    // Atualiza interpolação 3D dos jogadores remotos
    for (const [id, rp] of this.remotes) {
      rp.update(dt);
      // Timeout de segurança caso um peer caia abruptamente sem evento close
      if (performance.now() - rp.lastSeen > 18000) {
        this.onPeerLeave(id);
      }
    }

    // Envia posição e ações do jogador local (~18 vezes por segundo)
    this.syncAccum += dt;
    if (this.syncAccum >= 0.055) {
      const includeMeta = (this.tickCount = ((this.tickCount || 0) + 1) % 12) === 0;
      this.syncAccum = 0;
      const pkt = this.serializeLocalPlayer(includeMeta);
      // Em topologia estrela, clientes mandam para o Host (ou broadcast se Host ainda não definido)
      const target = (!this.isHost && this.hostId) ? this.hostId : null;
      this.senders.pState && this.senders.pState(pkt, target);
    }

    // Se somos o Host, envia snapshot dos Titãs (~15 vezes por segundo)
    if (this.isHost) {
      this.giantSyncAccum += dt;
      if (this.giantSyncAccum >= 0.066) {
        this.giantSyncAccum = 0;
        this.broadcastGiantsSnapshot();
      }
    }

    // Medição periódica de latência (ping)
    this.pingAccum += dt;
    if (this.pingAccum >= 2.5) {
      this.pingAccum = 0;
      for (const [id, rp] of this.remotes) {
        this.room.pingPeer(id).then((ms) => {
          if (ms > 0) rp.ping = Math.round(ms);
        }).catch(() => {});
      }
    }
  }

  leaveRoom(clearUrl = true) {
    clearTimeout(this.hostClaimTimer);
    if (this.active && this.isHost && this.isPublicRoom) {
      this.broadcastLobbyListing(true);
    }
    if (this.room) {
      this.room.leave();
      this.room = null;
    }
    for (const rp of this.remotes.values()) {
      rp.dispose();
    }
    this.remotes.clear();
    this.roomId = null;
    this.isHost = false;
    this.hostId = null;
    if (clearUrl) this.updateUrlParam(null);
    this.notifyUI();
  }

  updateUrlParam(roomCode) {
    if (typeof window === 'undefined' || !window.history) return;
    try {
      const url = new URL(window.location.href);
      if (roomCode) url.searchParams.set('room', roomCode);
      else url.searchParams.delete('room');
      window.history.replaceState(null, '', url.toString());
    } catch { /* ignore */ }
  }

  getShareableLink() {
    if (typeof window === 'undefined') return '';
    try {
      const url = new URL(window.location.href);
      if (this.roomId) url.searchParams.set('room', this.roomId);
      return url.toString();
    } catch {
      return window.location.href;
    }
  }

  async copyShareLink() {
    const link = this.getShareableLink();
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(link);
      }
    } catch { /* ignore */ }
    return link;
  }

  notifyUI() {
    if (this.onUIUpdate) this.onUIUpdate();
    if (this.onStatusChange) this.onStatusChange();
    if (this.onLobbyChange) this.onLobbyChange();
  }
}
