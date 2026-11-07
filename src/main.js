import * as THREE from 'three';
import { CFG } from './config.js';
import { World } from './world.js';
import { Effects } from './effects.js';
import { Audio } from './audio.js';
import { Input } from './input.js';
import { GiantManager, GIANT_TYPES, randomGiantType } from './giants.js';
import { Player, WEAPON_NAMES } from './player.js';
import { HUD } from './hud.js';
import { SKINS } from './models.js';
import { rand, pick, clamp } from './util.js';

const $ = (id) => document.getElementById(id);

// Layout padrão no estilo do RAoT (mesmas posições de teclas); tudo remapeável.
const DEFAULT_KEYS = {
  fwd: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD', up: 'KeyE', down: 'KeyQ',
  reel: 'Space', reelOut: 'ControlLeft', split: 'ShiftLeft', hookL: 'Mouse0', hookR: 'Mouse2', hardLand: 'ControlLeft',
  ready: 'KeyF', reload: 'KeyR', interact: 'KeyG', smoke: 'KeyC', acoustic: 'KeyV', emote: 'KeyT', scoreboard: 'Tab',
};
const KEY_GROUPS = [
  ['Movimento', ['fwd', 'back', 'left', 'right', 'up', 'down']],
  ['Equipamento', ['reel', 'reelOut', 'split', 'hookL', 'hookR', 'hardLand']],
  ['Ação', ['ready', 'reload', 'interact', 'smoke', 'acoustic', 'emote', 'scoreboard']],
];
const KEY_LABELS = {
  fwd: 'Frente', back: 'Trás', left: 'Esquerda', right: 'Direita', up: 'Subir / Pular', down: 'Descer / Rolar',
  reel: 'Reel In / Gás', reelOut: 'Reel Out (soltar cabo)', split: 'Separar ganchos', hookL: 'Gancho esq. / Ataque', hookR: 'Gancho dir. / Ataque', hardLand: 'Aterrissagem dura',
  ready: 'Postura de ataque', reload: 'Recarregar / Lâminas', interact: 'Interagir (reabastecer)', smoke: 'Sinalizador de fumaça', acoustic: 'Sinalizador acústico', emote: 'Emote', scoreboard: 'Placar',
};
const KEY_HELP = {
  fwd: 'Andar · no ar, toque 2× (e segure) para burst frontal',
  back: 'Andar · burst para trás (mais fraco)',
  left: 'Andar · burst lateral · preso: balançar',
  right: 'Andar · burst lateral · preso: balançar',
  up: 'No chão: pula · no ar: sobe com gás (toque 2× = burst vertical para cima)',
  down: 'No chão: rolamento · no ar: desce com gás (toque 2× = burst vertical para baixo)',
  reel: 'Preso: recolhe o cabo com gás (2 ganchos = +25% força) · solto: jato frontal',
  reelOut: 'Preso: solta cabo (estica e gera faíscas de freio)',
  split: 'Segure ao disparar: ganchos abrem para os lados da mira',
  hookL: 'Dispara/segura gancho esq. · em postura: Lunge / Disparo esq. (LMB+RMB = Giro Duplo)',
  hookR: 'Dispara/segura gancho dir. · em postura: Arremesso de Lâmina / Disparo dir.',
  hardLand: 'Segure ao tocar o chão: freia e absorve o impacto (senão desliza)',
  ready: 'Alterna postura (ou segure para encadear lunges seguidos)',
  reload: 'Troca lâminas ou recarrega APG / Lanças do Trovão (-10% veloc. durante recarga)',
  interact: 'Dentro do posto: reabastece (cancela se sair da zona)',
  smoke: 'Dispara sinalizador de fumaça na mira',
  acoustic: 'Estouro sonoro: atordoa gigantes próximos',
  emote: 'Alterna emotes (Entregar o Coração, Acenar, Vitória, Inspecionar)',
  scoreboard: 'Segure para ver estatísticas',
};

export function keyName(code) {
  if (!code) return '—';
  const map = { Space: 'ESPAÇO', ShiftLeft: 'SHIFT ESQ', ShiftRight: 'SHIFT DIR', ControlLeft: 'CTRL ESQ', ControlRight: 'CTRL DIR', AltLeft: 'ALT', Mouse0: 'MOUSE ESQ', Mouse1: 'MOUSE MEIO', Mouse2: 'MOUSE DIR', Mouse3: 'MOUSE 4', Mouse4: 'MOUSE 5', Tab: 'TAB', CapsLock: 'CAPS' };
  if (map[code]) return map[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  return code.toUpperCase();
}

const UPGRADES = [
  { id: 'gas', ic: 'GÁS+', name: 'Tanques Ampliados', desc: '+30 de capacidade de gás.', apply: (p) => { p.st.gasMax += 30; } },
  { id: 'reel', ic: 'REEL', name: 'Carretel Reforçado', desc: 'Reel 20% mais rápido e mais forte.', apply: (p) => { p.st.reelSpeed *= 1.2; p.st.reelAccel *= 1.2; } },
  { id: 'dmg', ic: 'AÇO', name: 'Aço Temperado', desc: '+15% de dano por corte.', apply: (p) => { p.st.dmgMul *= 1.15; } },
  { id: 'wear', ic: 'FIO', name: 'Fio Duradouro', desc: 'Lâminas gastam 30% menos.', apply: (p) => { p.st.wearMul *= 0.7; } },
  { id: 'burst', ic: 'JATO', name: 'Bicos de Alta Pressão', desc: '+4 m/s na velocidade de burst.', apply: (p) => { p.st.burstSpeed += 4; } },
  { id: 'range', ic: 'CABO', name: 'Cabos Longos', desc: '+20 m de alcance dos ganchos.', apply: (p) => { p.st.hookRange += 20; } },
  { id: 'lunge', ic: 'BOTE', name: 'Instinto de Caça', desc: '+5 m de alcance do lunge.', apply: (p) => { p.st.lungeRange += 5; } },
  { id: 'stress', ic: 'CALMA', name: 'Sangue Frio', desc: 'Stress se recupera 40% mais rápido.', apply: (p) => { p.st.stressRecover *= 1.4; } },
  { id: 'hp', ic: 'VIDA', name: 'Couraça de Couro', desc: '+25 de vida máxima e cura total.', apply: (p) => { p.st.hpMax += 25; p.hp = p.st.hpMax; } },
  { id: 'sets', ic: 'KIT', name: 'Bainhas Extras', desc: '+2 pares de lâminas.', apply: (p) => { p.st.bladeSetsMax += 2; p.bladeSets += 2; } },
  { id: 'regen', ic: 'FOLE', name: 'Compressor de Bolso', desc: 'Regenera 1.5 de gás por segundo.', apply: (p) => { p.st.gasRegen += 1.5; } },
  { id: 'eco', ic: 'ECO', name: 'Válvulas Econômicas', desc: 'Todo uso de gás custa 20% menos.', apply: (p) => { p.st.gasCostMul *= 0.8; } },
  { id: 'bt', ic: 'FOCO', name: 'Foco Mortal', desc: 'O tempo desacelera ao cortar uma nuca.', once: true, apply: (p) => { p.st.bulletTime = true; } },
];

class Game {
  constructor() {
    this.canvas = $('game');
    this.keyName = keyName;
    this.loadSettings();
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog('#cfe0ea', 180, 1150);
    this.camera = new THREE.PerspectiveCamera(this.settings.fov, window.innerWidth / window.innerHeight, 0.1, 3000);

    this.hemi = new THREE.HemisphereLight('#cfe4ff', '#7a6a4a', 1.1);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight('#fff1d6', 2.3);
    this.sunDir = new THREE.Vector3(-0.45, 0.8, 0.35).normalize();
    this.scene.add(this.sun, this.sun.target);
    this.applyShadows();

    this.world = new World(this.scene);
    this.effects = new Effects(this.scene);
    this.audio = new Audio();
    this.audio.setVolume(this.settings.vol);
    this.input = new Input(this.canvas);
    this.giants = new GiantManager(this.scene);
    this.hud = new HUD(this);
    this.mode = { key: 'menu', godMode: true, infiniteGas: false };
    this.player = new Player(this);
    this.player.setSkin(this.settings.skin);
    this.player.weapon = this.settings.weapon || 'swords';
    this.ctx = { player: this.player, world: this.world, effects: this.effects, audio: this.audio, giants: this.giants.giants, game: this };

    this.state = 'menu';
    this.timeScale = 1; this.slowT = 0;
    this.race = null;
    this.records = this.loadRecords();

    window.addEventListener('resize', () => this.onResize());
    // Esc abre o menu (com Keyboard Lock em tela cheia o navegador entrega o Esc ao jogo)
    window.addEventListener('keydown', (e) => { if (e.code === 'Escape' && this.state === 'playing') this.pause(); });
    // Rede de segurança: Ctrl+W (Ctrl é Reel Out) pede confirmação em vez de fechar a aba
    window.addEventListener('beforeunload', (e) => { if (this.state !== 'menu') { e.preventDefault(); e.returnValue = ''; } });
    this.input.onLockChange = (locked) => {
      if (!locked && this.state === 'playing') this.pause();
    };
    this.flares = [];
    this.setupUI();
    this.enterMenu();
    this.last = performance.now();
    requestAnimationFrame((t) => this.loop(t));
  }

  // ================= CONFIGURAÇÕES =================
  loadSettings() {
    let s = {};
    try { s = JSON.parse(localStorage.getItem('bastiao.settings') || '{}'); } catch { s = {}; }
    this.settings = { sens: 1, fov: 75, vol: 0.7, shadow: 2, invertY: false, skin: 'vanguarda', weapon: 'swords', ...s };
    this.settings.keys = { ...DEFAULT_KEYS, ...(s.keys || {}) };
  }
  saveSettings() { try { localStorage.setItem('bastiao.settings', JSON.stringify(this.settings)); } catch { /* sem storage */ } }
  loadRecords() {
    try { return JSON.parse(localStorage.getItem('bastiao.records') || '{}'); } catch { return {}; }
  }
  saveRecords() { try { localStorage.setItem('bastiao.records', JSON.stringify(this.records)); } catch { /* sem storage */ } }

  applyShadows() {
    const q = +this.settings.shadow;
    this.renderer.shadowMap.enabled = q > 0;
    this.sun.castShadow = q > 0;
    const size = q >= 2 ? 4096 : 2048;
    if (this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
    }
    const S = 95;
    Object.assign(this.sun.shadow.camera, { left: -S, right: S, top: S, bottom: -S, near: 1, far: 500 });
    this.sun.shadow.camera.updateProjectionMatrix();
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.6;
    this.scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; });
  }

  onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  // ================= UI =================
  setupUI() {
    document.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => { this.audio.init(); this.audio.ui(); this.startMode(b.dataset.mode); }));
    document.querySelectorAll('[data-panel]').forEach((b) => b.addEventListener('click', () => {
      this.audio.init(); this.audio.ui();
      const id = 'panel-' + b.dataset.panel;
      document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('hidden', p.id !== id || !p.classList.contains('hidden')));
      if (document.querySelectorAll('.panel:not(.hidden)').length === 0) $('panel-info').classList.remove('hidden');
    }));
    $('btnResume').onclick = () => this.resume();
    $('btnRestart').onclick = () => this.startMode(this.mode.key);
    $('btnQuit').onclick = () => this.enterMenu();
    $('btnRetry').onclick = () => this.startMode(this.mode.key);
    $('btnMenu').onclick = () => this.enterMenu();
    $('btnResetKeys').onclick = () => { this.settings.keys = { ...DEFAULT_KEYS }; this.saveSettings(); this.buildKeybinds(); this.buildControlsTable(); };

    const bind = (id, key, cb) => {
      const el = $(id);
      if (el.type === 'checkbox') el.checked = !!this.settings[key]; else el.value = this.settings[key];
      el.addEventListener('input', () => {
        this.settings[key] = el.type === 'checkbox' ? el.checked : (el.tagName === 'SELECT' ? +el.value : parseFloat(el.value));
        this.saveSettings();
        cb && cb();
      });
    };
    bind('setSens', 'sens');
    bind('setFov', 'fov');
    bind('setVol', 'vol', () => this.audio.setVolume(this.settings.vol));
    bind('setShadow', 'shadow', () => this.applyShadows());
    bind('setInvert', 'invertY');
    this.buildKeybinds();
    this.buildControlsTable();
    this.buildSkins();
  }

  buildControlsTable() {
    const K = this.settings.keys;
    let html = '<tr><td>Mouse</td><td>Mirar / câmera</td></tr>';
    for (const [g, keys] of KEY_GROUPS) {
      html += '<tr><td colspan="2" style="color:var(--ink);padding-top:12px">' + g.toUpperCase() + '</td></tr>';
      html += keys.map((k) => '<tr><td>' + keyName(K[k]) + '</td><td><b>' + KEY_LABELS[k] + '</b> — ' + KEY_HELP[k] + '</td></tr>').join('');
    }
    html += '<tr><td colspan="2" style="color:var(--ink);padding-top:12px">ARMAS E CÂMERA (ESTILO RAoT)</td></tr>';
    html += '<tr><td>1 / 2 / 3</td><td><b>Trocar Arma</b> — Lâminas ODM (1) · Pistolas APG (2) · Lanças do Trovão (3)</td></tr>';
    html += '<tr><td>B / F5</td><td><b>Câmera</b> — Alterna entre 1ª Pessoa e 3ª Pessoa</td></tr>';
    html += '<tr><td>ESC</td><td>Menu / pausa</td></tr>';
    $('controlsTable').innerHTML = html;
  }

  buildKeybinds() {
    const box = $('keybinds');
    box.innerHTML = '';
    for (const k of KEY_GROUPS.flatMap((g) => g[1])) {
      const label = document.createElement('span');
      label.textContent = KEY_LABELS[k];
      const btn = document.createElement('button');
      btn.textContent = keyName(this.settings.keys[k]);
      btn.onclick = (e) => {
        e.stopPropagation();
        btn.classList.add('listening');
        btn.textContent = '...';
        const finish = (code) => {
          window.removeEventListener('keydown', onKey, true);
          window.removeEventListener('mousedown', onMouse, true);
          if (code && code !== 'Escape') this.settings.keys[k] = code;
          this.saveSettings();
          this.buildKeybinds();
          this.buildControlsTable();
        };
        const onKey = (ev) => { ev.preventDefault(); ev.stopPropagation(); finish(ev.code); };
        const onMouse = (ev) => { ev.preventDefault(); ev.stopPropagation(); finish('Mouse' + ev.button); };
        setTimeout(() => {
          window.addEventListener('keydown', onKey, true);
          window.addEventListener('mousedown', onMouse, true);
        }, 50);
      };
      box.append(label, btn);
    }
  }

  buildSkins() {
    const box = $('skinList');
    box.innerHTML = '';
    for (const [k, s] of Object.entries(SKINS)) {
      const d = document.createElement('div');
      d.className = 'skin' + (this.settings.skin === k ? ' sel' : '');
      d.innerHTML = `<div class="sw"><i style="background:${s.cape}"></i><i style="background:${s.jacket}"></i><i style="background:${s.pants}"></i></div><b>${s.name}</b>`;
      d.onclick = () => { this.settings.skin = k; this.saveSettings(); this.player.setSkin(k); this.buildSkins(); this.audio.init(); this.audio.ui(); };
      box.appendChild(d);
    }
    // Seletor de armamento inicial (ODM / APG / Lanças do Trovão)
    let wBox = $('weaponSelectBox');
    if (!wBox) {
      const h = document.createElement('h3');
      h.style.marginTop = '16px';
      h.textContent = 'Armamento (1 / 2 / 3 em jogo)';
      wBox = document.createElement('div');
      wBox.id = 'weaponSelectBox';
      wBox.style.display = 'flex';
      wBox.style.flexDirection = 'column';
      wBox.style.gap = '8px';
      box.parentElement.append(h, wBox);
    }
    wBox.innerHTML = '';
    const WEAP_DESC = {
      swords: 'Lunge teleguiado (LMB), Arremesso de Lâmina (RMB) e Giro Duplo (LMB+RMB)',
      apg: 'Pistolas Anti-Pessoal de chumbo (LMB/RMB) e Disparo Duplo com recuo aéreo',
      spears: 'Foguetes perfurantes que cravam no alvo e detonam ao clicar de novo (quebra Blindado)',
    };
    for (const [wk, wName] of Object.entries(WEAPON_NAMES)) {
      const d = document.createElement('div');
      d.className = 'skin' + (this.settings.weapon === wk ? ' sel' : '');
      d.innerHTML = `<div><b>${wName}</b><div class="dim" style="font-size:12px;margin-top:2px">${WEAP_DESC[wk]}</div></div>`;
      d.onclick = () => {
        this.settings.weapon = wk;
        this.saveSettings();
        this.player.setWeapon(wk);
        this.buildSkins();
        this.audio.init();
        this.audio.ui();
      };
      wBox.appendChild(d);
    }
  }

  showScreen(id) {
    for (const s of ['menu', 'pause', 'upgrade', 'gameover']) $(s).classList.toggle('hidden', s !== id);
  }

  renderRecords() {
    const r = this.records;
    const parts = [];
    if (r.wave) parts.push(`Melhor onda: <b>${r.wave}</b>`);
    if (r.score) parts.push(`Maior pontuação: <b>${Math.round(r.score).toLocaleString('pt-BR')}</b>`);
    if (r.race) parts.push(`Melhor corrida: <b>${r.race.toFixed(2)}s</b>`);
    $('records').innerHTML = parts.join('<br>');
  }

  // ================= ESTADOS =================
  enterMenu() {
    this.state = 'menu';
    this.input.unlock();
    if (navigator.keyboard && navigator.keyboard.unlock) navigator.keyboard.unlock();
    this.hud.hide();
    this.showScreen('menu');
    this.renderRecords();
    this.cleanupMode();
    this.mode = { key: 'menu', godMode: true };
    // gigantes passeando no fundo
    for (let i = 0; i < 5; i++) {
      const a = rand(0, Math.PI * 2), r = rand(40, 200);
      this.giants.spawn(pick(['comum', 'comum', 'pequeno', 'errante']), Math.cos(a) * r, Math.sin(a) * r);
    }
    this.player.reset(new THREE.Vector3(0, -50, 0));
    this.player.alive = false;
    this.player.model.group.visible = false;
    this.menuT = 0;
  }

  cleanupMode() {
    this.giants.clear();
    this.effects.clear();
    this.player.clearProjectiles();
    this.hud.clearTransient();
    if (this.race) { for (const r of this.race.rings) this.scene.remove(r.mesh); this.race = null; }
    for (const f of this.flares) this.scene.remove(f.m);
    this.flares = [];
    this.timeScale = 1; this.slowT = 0;
    clearTimeout(this.pendingT);
  }

  startMode(key) {
    this.cleanupMode();
    this.showScreen(null);
    this.hud.show();
    this.state = 'playing';
    this.stats = { kills: 0, severs: 0, maxSpeed: 0, time: 0, bestHit: 0 };
    this.score = 0; this.combo = 0; this.comboT = 0;
    this.player.resetStats();
    const spawn = new THREE.Vector3(-60, 1, 30);
    this.mode = { key, godMode: false, infiniteGas: false };
    if (key === 'survival') {
      this.wave = 0;
      this.player.reset(new THREE.Vector3(-20, 1, 0));
      this.player.yaw = -Math.PI / 2; this.player.pitch = 0.1;
      this.nextWave(3);
    } else if (key === 'training') {
      this.mode.godMode = true;
      this.player.reset(spawn);
      this.player.yaw = -Math.PI / 2;
      this.setupTraining();
      this.hud.setWave('TREINO', 'Bonecos fixos + gigantes lentos · 1:ODM 2:APG 3:LANÇAS');
      this.hud.bigMsg('TREINO', 'Pratique lunge, arremesso de lâminas, APG e Lanças do Trovão');
    } else if (key === 'race') {
      this.mode.godMode = true;
      this.setupRace();
    } else if (key === 'free') {
      this.player.reset(spawn);
      for (let i = 0; i < 7; i++) this.spawnRandomGiant(false);
      this.hud.setWave('EXPLORAÇÃO LIVRE', 'Gigantes vagando pela cidade · 1:ODM 2:APG 3:LANÇAS');
      this.hud.bigMsg('EXPLORAÇÃO', 'A cidade é sua');
    }
    this.hud.setScore(0, 0);
    this.lockInput();
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.showScreen('pause');
    this.audio.setGas(0); this.audio.setWind(0);
  }
  resume() {
    this.showScreen(null);
    this.state = 'playing';
    this.lockInput();
  }

  // Captura mouse; em tela cheia trava o teclado (Ctrl+W, Ctrl+S etc. vão para o jogo).
  lockInput() {
    this.input.lock();
    const el = document.documentElement;
    const kb = navigator.keyboard;
    if (!document.fullscreenElement && el.requestFullscreen) {
      el.requestFullscreen({ navigationUI: 'hide' }).then(() => {
        if (kb && kb.lock) kb.lock().catch(() => {});
        this.input.lock();
      }).catch(() => {});
    } else if (kb && kb.lock) kb.lock().catch(() => {});
  }

  // ================= SINALIZADORES =================
  spawnFlare(kind, pos, vel) {
    const color = kind === 'smoke' ? '#5dff7a' : '#ffe08a';
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.25, 0.25), new THREE.MeshBasicMaterial({ color }));
    m.position.copy(pos);
    this.scene.add(m);
    this.flares.push({ kind, m, vel: vel.clone(), t: 0, color, popped: false });
    this.audio.flare('smoke');
  }

  updateFlares(dt) {
    for (let i = this.flares.length - 1; i >= 0; i--) {
      const f = this.flares[i];
      f.t += dt;
      f.vel.y -= 9 * dt;
      f.vel.multiplyScalar(1 - dt * 0.6);
      f.m.position.addScaledVector(f.vel, dt);
      if (f.kind === 'smoke') {
        if (f.t < 6) for (let k = 0; k < 2; k++) this.effects.steam.spawn({ pos: f.m.position, vel: new THREE.Vector3(rand(-1, 1), rand(0, 1), rand(-1, 1)), size: rand(0.5, 1), grow: 4, life: rand(3, 5), drag: 0.6, color: f.color, floor: false });
      } else if (!f.popped && f.t > 0.9) {
        f.popped = true;
        this.audio.flare('acoustic');
        this.effects.sparks(f.m.position, 40);
        for (const g of this.giants.giants) {
          if (g.alive && g.pos.distanceTo(f.m.position) < 70) { g.stunT = 3.5; if (g.grab && g.grab.caught) g.releaseGrab(this.ctx, true); }
        }
        this.hud.flashMsg('ESTOURO SONORO — gigantes atordoados', '#ffe08a');
      }
      if (f.t > 7 || f.m.position.y < 0) { this.scene.remove(f.m); f.m.geometry.dispose(); this.flares.splice(i, 1); }
    }
  }

  // ================= MODOS =================
  spawnRandomGiant(chase, type) {
    const p = this.player.pos;
    for (let k = 0; k < 30; k++) {
      const a = rand(0, Math.PI * 2), r = rand(30, CFG.WALL_R - 20);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (Math.hypot(x - p.x, z - p.z) < 70) continue;
      const g = this.giants.spawn(type || randomGiantType(3), x, z);
      if (chase) { g.alwaysChase = true; g.state = 'chase'; }
      return g;
    }
    return null;
  }

  nextWave(delay = 4) {
    this.wave++;
    const w = this.wave;
    const boss = w % 5 === 0;
    this.hud.setWave(`ONDA ${w}`, boss ? 'UM COLOSSO SE APROXIMA' : 'Prepare-se');
    this.waveSpawning = true;
    this.pendingT = setTimeout(() => {
      if (this.state !== 'playing' && this.state !== 'paused') return;
      this.hud.bigMsg(`ONDA ${w}`, boss ? 'O COLOSSO' : 'Eles atravessaram a brecha');
      this.audio.waveStart();
      const count = Math.min(16, 2 + w + Math.floor(w / 3));
      const list = [];
      if (boss) list.push('colosso');
      for (let i = 0; i < (boss ? count - 3 : count); i++) list.push(randomGiantType(w));
      list.forEach((type, i) => {
        let x, z;
        const inside = w >= 3 && Math.random() < 0.35 && type !== 'colosso';
        if (inside) {
          const g = this.spawnRandomGiant(true, type);
          if (g) return;
        }
        const a = CFG.BREACH_ANGLE + rand(-0.35, 0.35);
        const r = CFG.WALL_R + rand(50, 150) + i * 3;
        x = Math.cos(a) * r; z = Math.sin(a) * r;
        const g = this.giants.spawn(type, x, z);
        g.alwaysChase = true; g.state = 'chase';
      });
      this.waveSpawning = false;
      this.updateWaveSub();
    }, delay * 1000);
  }

  updateWaveSub() {
    if (this.mode.key !== 'survival' || this.waveSpawning) return;
    this.hud.setWave(`ONDA ${this.wave}`, `${this.giants.aliveCount} gigante(s) restante(s)`);
  }

  waveCleared() {
    this.score += 250 * this.wave;
    this.hud.bigMsg('ONDA LIMPA', `+${250 * this.wave} pontos`);
    this.audio.resupply();
    this.pendingT = setTimeout(() => {
      if (this.state !== 'playing') return;
      this.showUpgrades();
    }, 1800);
  }

  showUpgrades() {
    this.state = 'upgrade';
    this.input.unlock();
    this.showScreen('upgrade');
    $('upTitle').textContent = `ONDA ${this.wave} CONCLUÍDA`;
    const taken = this.taken || (this.taken = new Set());
    const pool = UPGRADES.filter((u) => !(u.once && taken.has(u.id)));
    const choices = [];
    while (choices.length < 3 && pool.length) choices.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    const box = $('cards');
    box.innerHTML = '';
    for (const u of choices) {
      const c = document.createElement('div');
      c.className = 'card';
      c.innerHTML = `<div class="ic">${u.ic}</div><h4>${u.name}</h4><p>${u.desc}</p>`;
      c.onclick = () => {
        u.apply(this.player);
        taken.add(u.id);
        this.audio.ui();
        this.hud.feed(`Melhoria: ${u.name}`);
        this.player.gas = this.player.st.gasMax;
        this.showScreen(null);
        this.state = 'playing';
        this.lockInput();
        this.nextWave(4);
      };
      box.appendChild(c);
    }
  }

  setupTraining() {
    const spots = [[-30, 0], [-30, 40], [-70, -30], [40, -40], [-100, 10], [-60, 70]];
    for (const [x, z] of spots) {
      const g = this.giants.spawn('boneco', x, z);
      g.heading = rand(0, Math.PI * 2);
    }
    for (let i = 0; i < 2; i++) {
      const g = this.giants.spawn('comum', -40 + i * 30, -80);
      g.speedMul = 0.5;
    }
  }

  setupRace() {
    this.hud.setWave('CORRIDA', 'Atravesse os anéis o mais rápido possível');
    const rings = [];
    const pts = [];
    const N = 16;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2 + Math.PI;
      const r = 150 + Math.sin(i * 1.7) * 55;
      const y = 14 + ((i * 7) % 5) * 6 + (i % 4 === 0 ? 18 : 0);
      pts.push(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r));
    }
    // um anel passando pela torre central e um no topo da muralha
    pts.splice(5, 0, new THREE.Vector3(-14, 40, 14));
    pts.splice(11, 0, new THREE.Vector3(Math.cos(2.2) * CFG.WALL_R, CFG.WALL_H + 6, Math.sin(2.2) * CFG.WALL_R));
    for (const p of pts) {
      // não deixar dentro de prédios
      for (let k = 0; k < 20; k++) {
        const inside = this.world.colliders.some((c) => p.x > c.min.x - 4 && p.x < c.max.x + 4 && p.z > c.min.z - 4 && p.z < c.max.z + 4 && p.y < c.max.y + 4 && p.y > c.min.y - 4);
        if (!inside) break;
        p.y += 4;
      }
    }
    const geo = new THREE.TorusGeometry(5, 0.35, 6, 24);
    pts.forEach((p, i) => {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: '#5dff7a', transparent: true, opacity: 0.85 }));
      m.position.copy(p);
      const next = pts[(i + 1) % pts.length];
      m.lookAt(next);
      this.scene.add(m);
      rings.push({ pos: p, mesh: m });
    });
    this.race = { rings, idx: 0, t: 0, started: false, countdown: 3 };
    const start = pts[0].clone().add(new THREE.Vector3(0, 0, 0));
    const dirToFirst = pts[1].clone().sub(pts[0]).normalize();
    this.player.reset(new THREE.Vector3(start.x - dirToFirst.x * 40, 1, start.z - dirToFirst.z * 40));
    const look = pts[0].clone().sub(this.player.pos);
    this.player.yaw = Math.atan2(-look.x, -look.z);
    this.player.pitch = 0.15;
    this.hud.bigMsg('3', 'Prepare-se');
    this.updateRingColors();
  }

  updateRingColors() {
    if (!this.race) return;
    this.race.rings.forEach((r, i) => {
      r.mesh.visible = i >= this.race.idx;
      r.mesh.material.color.set(i === this.race.idx ? '#5dff7a' : i === this.race.idx + 1 ? '#c8ffb0' : '#9fb8a0');
      r.mesh.material.opacity = i === this.race.idx ? 0.95 : 0.35;
      r.mesh.scale.setScalar(i === this.race.idx ? 1.15 : 1);
    });
  }

  updateRace(dt) {
    const R = this.race;
    if (!R) return;
    if (!R.started) {
      const prev = Math.ceil(R.countdown);
      R.countdown -= dt;
      const now = Math.ceil(R.countdown);
      if (now !== prev && now > 0) { this.hud.bigMsg(String(now), 'Prepare-se', 0.9); this.audio.ui(); }
      // segura o jogador no lugar durante a contagem
      this.player.vel.set(0, Math.min(0, this.player.vel.y), 0);
      if (R.countdown <= 0) { R.started = true; this.hud.bigMsg('VAI!', '', 0.8); this.audio.ring(); }
      return;
    }
    if (R.finished) return;
    R.t += dt;
    this.hud.setWave('CORRIDA', `${R.t.toFixed(2)}s · anel ${R.idx + 1}/${R.rings.length}`);
    const ring = R.rings[R.idx];
    if (ring && this.player.pos.distanceTo(ring.pos) < 6.2) {
      R.idx++;
      this.audio.ring();
      this.effects.sparks(ring.pos, 20);
      this.updateRingColors();
      if (R.idx >= R.rings.length) {
        R.finished = true;
        const best = this.records.race;
        const isBest = !best || R.t < best;
        if (isBest) { this.records.race = R.t; this.saveRecords(); }
        this.hud.bigMsg(`${R.t.toFixed(2)}s`, isBest ? 'NOVO RECORDE!' : `Recorde: ${best.toFixed(2)}s`, 5);
        this.pendingT = setTimeout(() => { if (this.mode.key === 'race') this.startMode('race'); }, 5000);
      }
    }
  }

  // ================= EVENTOS DE COMBATE =================
  onPlayerHit(res, q, dmg, pos) {
    const H = this.hud, g = q.giant;
    this.stats.bestHit = Math.max(this.stats.bestHit, dmg);
    switch (res.r) {
      case 'kill': {
        this.combo = this.comboT > 0 ? this.combo + 1 : 1;
        this.comboT = 7;
        const pts = Math.round((g.T.score + dmg) * this.combo);
        this.score += pts;
        this.stats.kills++;
        H.damageNumber(pos, String(dmg), 'kill');
        H.feed(`Nuca cortada — ${g.T.name} (+${pts})`);
        this.audio.kill();
        this.effects.addShake(0.35);
        if (this.player.st.bulletTime || this.mode.key === 'training') this.slowMo(0.3, 0.45);
        if (this.mode.key === 'training' && g.T.dummy) {
          const x = g.pos.x, z = g.pos.z;
          setTimeout(() => { if (this.mode.key === 'training') this.giants.spawn('boneco', x, z); }, 4000);
        }
        if (this.mode.key === 'free') setTimeout(() => { if (this.mode.key === 'free') this.spawnRandomGiant(false); }, 12000);
        if (this.mode.key === 'training' && !g.T.dummy) setTimeout(() => { if (this.mode.key === 'training') { const n = this.giants.spawn('comum', -40, -80); n.speedMul = 0.5; } }, 6000);
        break;
      }
      case 'weak':
        H.damageNumber(pos, String(dmg), 'weak');
        H.flashMsg(`RASO! Precisa de ${res.need}+ de dano — ganhe velocidade`, '#ff9a7a');
        this.audio.hit(0.6);
        break;
      case 'sever':
        this.stats.severs++;
        this.score += 40;
        H.damageNumber(pos, res.limb.startsWith('leg') ? 'PERNA!' : 'BRAÇO!', 'sever');
        if (res.limb.startsWith('leg')) H.flashMsg('GIGANTE CAIU — vá para a nuca!', '#ffd27a');
        this.audio.hit(1);
        break;
      case 'blind':
        this.score += 30;
        H.damageNumber(pos, 'CEGO!', 'sever');
        this.audio.hit(0.8);
        break;
      case 'armor':
        H.damageNumber(pos, String(dmg), 'weak');
        H.flashMsg('ARMADURA NA NUCA — continue golpeando ou use Lanças do Trovão [3]', '#d8d0c0');
        break;
      case 'armorbreak':
        H.damageNumber(pos, 'ARMADURA QUEBRADA', 'sever');
        this.score += 60;
        this.audio.hit(1);
        break;
      case 'weaklimb':
        H.damageNumber(pos, String(dmg), 'weak');
        this.audio.hit(0.5);
        break;
    }
    H.setScore(this.score, this.combo);
  }

  slowMo(scale, dur) { this.timeScale = scale; this.slowT = dur; }

  onPlayerDeath(cause) {
    const msgs = { eaten: 'DEVORADO', impact: 'ESMAGADO NA PAREDE', shock: 'ESMAGADO', steam: 'QUEIMADO PELO VAPOR' };
    this.hud.bigMsg(msgs[cause] || 'VOCÊ CAIU', '', 2.5);
    this.audio.setGas(0);
    if (this.mode.key === 'survival') {
      this.pendingT = setTimeout(() => this.gameOver(cause), 2600);
    } else {
      this.pendingT = setTimeout(() => {
        if (this.mode.key === 'menu') return;
        this.player.reset(new THREE.Vector3(-60, 1, 30));
      }, 2500);
    }
  }

  gameOver(cause) {
    this.state = 'gameover';
    this.input.unlock();
    this.showScreen('gameover');
    const r = this.records;
    let rec = false;
    if (!r.wave || this.wave > r.wave) { r.wave = this.wave; rec = true; }
    if (!r.score || this.score > r.score) { r.score = this.score; rec = true; }
    this.saveRecords();
    $('goTitle').textContent = rec ? 'NOVO RECORDE' : 'VOCÊ CAIU';
    const s = this.stats;
    $('goStats').innerHTML = [
      ['Onda alcançada', this.wave],
      ['Pontuação', Math.round(this.score).toLocaleString('pt-BR')],
      ['Gigantes abatidos', s.kills],
      ['Membros cortados', s.severs],
      ['Maior dano', s.bestHit],
      ['Velocidade máxima', Math.round(s.maxSpeed) + ' m/s'],
      ['Tempo', Math.floor(s.time / 60) + 'min ' + Math.floor(s.time % 60) + 's'],
    ].map(([a, b]) => `<div>${a}<b>${b}</b></div>`).join('');
  }

  // ================= LOOP =================
  loop(t) {
    requestAnimationFrame((tt) => this.loop(tt));
    let dt = Math.min(0.05, (t - this.last) / 1000);
    this.last = t;
    if (this.slowT > 0) { this.slowT -= dt; if (this.slowT <= 0) this.timeScale = 1; }
    const gdt = dt * this.timeScale;

    if (this.state === 'playing') {
      this.player.update(gdt);
      this.giants.update(gdt, this.ctx);
      this.stats.time += gdt;
      this.stats.maxSpeed = Math.max(this.stats.maxSpeed, this.player.speed);
      if (this.comboT > 0) { this.comboT -= gdt; if (this.comboT <= 0) { this.combo = 0; this.hud.setScore(this.score, 0); } }
      if (this.mode.key === 'survival' && !this.waveSpawning && this.player.alive && this.giants.aliveCount === 0 && !this.clearedFlag) {
        this.clearedFlag = true;
        this.waveCleared();
      }
      if (this.giants.aliveCount > 0) this.clearedFlag = false;
      if (this.mode.key === 'survival') this.updateWaveSub();
      if (this.mode.key === 'race') this.updateRace(gdt);
      this.updateFlares(gdt);
      this.hud.update(dt);
    } else if (this.state === 'menu') {
      this.menuT += dt;
      const a = this.menuT * 0.05;
      this.camera.position.set(Math.cos(a) * 170, 75 + Math.sin(this.menuT * 0.2) * 8, Math.sin(a) * 170);
      this.camera.lookAt(0, 20, 0);
      if (this.camera.fov !== 60) { this.camera.fov = 60; this.camera.updateProjectionMatrix(); }
      this.giants.update(dt, this.ctx);
    }
    this.effects.update(gdt);
    this.world.update(dt, this.camera.position);
    // sol segue o foco (jogador ou câmera do menu)
    const focus = this.state === 'menu' ? new THREE.Vector3(0, 0, 0) : this.player.pos;
    this.sun.target.position.copy(focus);
    this.sun.position.copy(focus).addScaledVector(this.sunDir, 220);
    this.renderer.render(this.scene, this.camera);
    this.input.endFrame();
  }
}

window.game = new Game();
