import * as THREE from 'three';
import { mulberry32 } from './util.js';

const texCache = new Map();

const noopGrad = { addColorStop() {} };
const noopCtx = {
  fillStyle: '', strokeStyle: '', lineWidth: 1,
  fillRect() {}, strokeRect() {}, clearRect() {}, rect() {}, roundRect() {},
  beginPath() {}, moveTo() {}, lineTo() {}, quadraticCurveTo() {}, bezierCurveTo() {}, arc() {}, ellipse() {}, closePath() {},
  fill() {}, stroke() {},
  createLinearGradient() { return noopGrad; },
  createRadialGradient() { return noopGrad; },
};

function makeCanvas(w, h) {
  if (typeof document === 'undefined') return [{ width: w, height: h, _headless: true }, noopCtx];
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

function finishTex(canvas, repeatX = 1, repeatY = 1, srgb = true) {
  const t = canvas._headless
    ? new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1)
    : new THREE.CanvasTexture(canvas);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeatX, repeatY);
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

// 1. Reboco medieval europeu (Trost / Shiganshina) — neutro claro para multiplicar com vertexColors
export function getPlasterTextures() {
  if (texCache.has('plaster')) return texCache.get('plaster');
  const rng = mulberry32(101);
  const [c, g] = makeCanvas(256, 256);
  const [bc, bg] = makeCanvas(256, 256);
  g.fillStyle = '#f4f0e8';
  g.fillRect(0, 0, 256, 256);
  bg.fillStyle = '#808080';
  bg.fillRect(0, 0, 256, 256);

  // Manchas suaves de reboco envelhecido e umidade sutil
  for (let i = 0; i < 420; i++) {
    const x = rng() * 256, y = rng() * 256, r = 8 + rng() * 28;
    const v = Math.floor(232 + (rng() - 0.5) * 26);
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, `rgba(${v},${v - 2},${v - 6},0.18)`);
    grd.addColorStop(1, 'rgba(244,240,232,0)');
    g.fillStyle = grd;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // Granulação fina de estuque
  for (let i = 0; i < 3500; i++) {
    const x = rng() * 256, y = rng() * 256;
    const b = Math.floor(110 + rng() * 36);
    bg.fillStyle = `rgb(${b},${b},${b})`;
    bg.fillRect(x, y, 2, 2);
    g.fillStyle = rng() > 0.5 ? 'rgba(255,255,255,0.08)' : 'rgba(90,75,60,0.06)';
    g.fillRect(x, y, 2, 2);
  }
  const out = { map: finishTex(c, 1, 1, true), bumpMap: finishTex(bc, 1, 1, false) };
  texCache.set('plaster', out);
  return out;
}

// 2. Telhas de barro / ardósia sobrepostas (estilo RAoT Trost)
export function getRoofTextures() {
  if (texCache.has('roof')) return texCache.get('roof');
  const rng = mulberry32(202);
  const [c, g] = makeCanvas(256, 256);
  const [bc, bg] = makeCanvas(256, 256);
  g.fillStyle = '#e8e2dc';
  g.fillRect(0, 0, 256, 256);
  bg.fillStyle = '#808080';
  bg.fillRect(0, 0, 256, 256);

  const rows = 8, cols = 8;
  const rh = 256 / rows, cw = 256 / cols;
  for (let r = 0; r < rows; r++) {
    const y = r * rh;
    const off = (r % 2) * (cw * 0.5);
    for (let k = -1; k <= cols; k++) {
      const x = k * cw + off;
      const shade = 218 + Math.floor((rng() - 0.5) * 34);
      const grd = g.createLinearGradient(0, y, 0, y + rh);
      grd.addColorStop(0, `rgb(${shade - 28},${shade - 30},${shade - 32})`);
      grd.addColorStop(0.25, `rgb(${shade + 12},${shade + 10},${shade + 8})`);
      grd.addColorStop(0.88, `rgb(${shade},${shade - 2},${shade - 4})`);
      grd.addColorStop(1, `rgb(${shade - 48},${shade - 50},${shade - 52})`);
      g.fillStyle = grd;
      g.fillRect(x + 1, y, cw - 2, rh - 1);

      // Relevo côncavo/convexo das telhas coloniais/germânicas
      const bGrd = bg.createLinearGradient(x, y, x + cw, y);
      bGrd.addColorStop(0, '#555');
      bGrd.addColorStop(0.5, '#d8d8d8');
      bGrd.addColorStop(1, '#555');
      bg.fillStyle = bGrd;
      bg.fillRect(x + 1, y + 1, cw - 2, rh - 3);

      // Linha escura de encaixe inferior da telha
      g.fillStyle = 'rgba(25,18,14,0.38)';
      g.fillRect(x, y + rh - 2.5, cw, 2.5);
      g.fillStyle = 'rgba(30,22,18,0.22)';
      g.fillRect(x, y, 1.5, rh);
    }
  }
  const out = { map: finishTex(c, 1, 1, true), bumpMap: finishTex(bc, 1, 1, false) };
  texCache.set('roof', out);
  return out;
}

// 3. Blocos de pedra talhada da Muralha Maria/Rose, fundações e torre central
export function getStoneWallTextures() {
  if (texCache.has('stone')) return texCache.get('stone');
  const rng = mulberry32(303);
  const [c, g] = makeCanvas(256, 256);
  const [bc, bg] = makeCanvas(256, 256);
  g.fillStyle = '#aba69c';
  g.fillRect(0, 0, 256, 256);
  bg.fillStyle = '#484848';
  bg.fillRect(0, 0, 256, 256);

  const rows = 8;
  const rh = 256 / rows;
  for (let r = 0; r < rows; r++) {
    const y = r * rh;
    let x = -((r % 2) * 32);
    while (x < 256) {
      const bw = 44 + Math.floor(rng() * 28);
      const v = 212 + Math.floor((rng() - 0.5) * 34);
      g.fillStyle = `rgb(${v},${v - 2},${v - 6})`;
      g.fillRect(x + 2, y + 2, bw - 3, rh - 3);
      // Chanfro iluminado no topo do bloco
      g.fillStyle = 'rgba(255,255,250,0.22)';
      g.fillRect(x + 2, y + 2, bw - 3, 2);
      g.fillStyle = 'rgba(30,28,24,0.28)';
      g.fillRect(x + 2, y + rh - 3, bw - 3, 2);

      const bv = 175 + Math.floor((rng() - 0.5) * 40);
      bg.fillStyle = `rgb(${bv},${bv},${bv})`;
      bg.fillRect(x + 2, y + 2, bw - 3, rh - 3);
      x += bw;
    }
  }
  // Riscos verticais de intempérie (chuva/musgo sutil)
  for (let i = 0; i < 60; i++) {
    const x = rng() * 256, w = 2 + rng() * 6;
    g.fillStyle = 'rgba(60,64,52,0.06)';
    g.fillRect(x, 0, w, 256);
  }
  const out = { map: finishTex(c, 1, 1, true), bumpMap: finishTex(bc, 1, 1, false) };
  texCache.set('stone', out);
  return out;
}

// 4. Calçamento de paralelepípedos europeus para as ruas da cidade
export function getCobbleTextures(repX = 110, repY = 110) {
  const key = `cobble:${repX}:${repY}`;
  if (texCache.has(key)) return texCache.get(key);
  const rng = mulberry32(404);
  const [c, g] = makeCanvas(256, 256);
  const [bc, bg] = makeCanvas(256, 256);
  g.fillStyle = '#787062';
  g.fillRect(0, 0, 256, 256);
  bg.fillStyle = '#404040';
  bg.fillRect(0, 0, 256, 256);

  const rows = 10, rh = 256 / rows;
  for (let r = 0; r < rows; r++) {
    const y = r * rh;
    let x = -((r % 2) * 14);
    while (x < 256) {
      const w = 20 + Math.floor(rng() * 14);
      const v = 148 + Math.floor((rng() - 0.5) * 32);
      const warm = Math.floor((rng() - 0.4) * 12);
      g.fillStyle = `rgb(${v + warm},${v - 4},${v - 14})`;
      g.beginPath();
      g.roundRect(x + 1.5, y + 1.5, w - 3, rh - 3, 4);
      g.fill();
      g.fillStyle = 'rgba(255,250,240,0.16)';
      g.fillRect(x + 3, y + 2, w - 6, 2);

      const bv = 175 + Math.floor((rng() - 0.5) * 45);
      bg.fillStyle = `rgb(${bv},${bv},${bv})`;
      bg.beginPath();
      bg.roundRect(x + 2, y + 2, w - 4, rh - 4, 4);
      bg.fill();
      x += w;
    }
  }
  const out = { map: finishTex(c, repX, repY, true), bumpMap: finishTex(bc, repX, repY, false) };
  texCache.set(key, out);
  return out;
}

// 5. Gramado campestre estilizado (fora da Muralha — estilo anime / RAoT Forest)
export function getGrassTextures(repX = 160, repY = 160) {
  const key = `grass:${repX}:${repY}`;
  if (texCache.has(key)) return texCache.get(key);
  const rng = mulberry32(505);
  const [c, g] = makeCanvas(256, 256);
  g.fillStyle = '#6c9149';
  g.fillRect(0, 0, 256, 256);

  for (let i = 0; i < 380; i++) {
    const x = rng() * 256, y = rng() * 256, r = 10 + rng() * 32;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    const bright = rng() > 0.45;
    grd.addColorStop(0, bright ? 'rgba(138,176,78,0.24)' : 'rgba(74,112,48,0.24)');
    grd.addColorStop(1, 'rgba(108,145,73,0)');
    g.fillStyle = grd;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // Tufos de grama e trevos sutis
  for (let i = 0; i < 2200; i++) {
    const x = rng() * 256, y = rng() * 256;
    g.fillStyle = rng() > 0.5 ? 'rgba(162,198,92,0.35)' : 'rgba(56,90,38,0.32)';
    g.fillRect(x, y, 1.8, 4.5);
  }
  const out = { map: finishTex(c, repX, repY, true) };
  texCache.set(key, out);
  return out;
}

// 6. Madeira enxaimel escura (vigas Tudor)
export function getTimberTexture() {
  if (texCache.has('timber')) return texCache.get('timber');
  const rng = mulberry32(606);
  const [c, g] = makeCanvas(128, 128);
  g.fillStyle = '#e0d6cc';
  g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 220; i++) {
    const x = rng() * 128;
    const v = 185 + Math.floor((rng() - 0.5) * 55);
    g.fillStyle = `rgba(${v},${v - 8},${v - 16},0.35)`;
    g.fillRect(x, 0, 1 + rng() * 2.5, 128);
  }
  const out = finishTex(c, 1, 1, true);
  texCache.set('timber', out);
  return out;
}

// 7. Vidraça europeia quadriculada com reflexo de céu e cortina/luz interna sutil
export function getWindowTexture() {
  if (texCache.has('window')) return texCache.get('window');
  const [c, g] = makeCanvas(128, 160);
  // Fundo de vidro azul-ardósia com reflexo do céu no topo e calor interno na base
  const grd = g.createLinearGradient(0, 0, 0, 160);
  grd.addColorStop(0, '#4a647d');
  grd.addColorStop(0.55, '#2b3948');
  grd.addColorStop(1, '#524334');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 160);

  // Reflexo diagonal de luz solar no vidro
  g.fillStyle = 'rgba(205,230,255,0.22)';
  g.beginPath();
  g.moveTo(14, 0); g.lineTo(54, 0); g.lineTo(10, 110); g.lineTo(0, 80);
  g.closePath();
  g.fill();

  // Moldura de madeira escura + divisórias (muntins 2x3 painéis)
  g.fillStyle = '#2d1e15';
  g.fillRect(0, 0, 128, 10);
  g.fillRect(0, 150, 128, 10);
  g.fillRect(0, 0, 10, 160);
  g.fillRect(118, 0, 10, 160);
  g.fillRect(60, 0, 8, 160);
  g.fillRect(0, 52, 128, 6);
  g.fillRect(0, 102, 128, 6);

  const out = finishTex(c, 1, 1, true);
  out.wrapS = THREE.ClampToEdgeWrapping;
  out.wrapT = THREE.ClampToEdgeWrapping;
  texCache.set('window', out);
  return out;
}

// 8. Casca sulcada de árvore gigante (Floresta de Árvores Gigantes do AoT/RAoT)
export function getBarkTextures() {
  if (texCache.has('bark')) return texCache.get('bark');
  const rng = mulberry32(707);
  const [c, g] = makeCanvas(128, 256);
  const [bc, bg] = makeCanvas(128, 256);
  g.fillStyle = '#d8cec4';
  g.fillRect(0, 0, 128, 256);
  bg.fillStyle = '#808080';
  bg.fillRect(0, 0, 128, 256);
  for (let i = 0; i < 180; i++) {
    const x = rng() * 128, w = 2 + rng() * 5;
    const dark = rng() > 0.45;
    g.fillStyle = dark ? 'rgba(45,30,20,0.32)' : 'rgba(255,245,235,0.18)';
    g.fillRect(x, 0, w, 256);
    bg.fillStyle = dark ? '#383838' : '#c8c8c8';
    bg.fillRect(x, 0, w, 256);
  }
  const out = { map: finishTex(c, 3, 6, true), bumpMap: finishTex(bc, 3, 6, false) };
  texCache.set('bark', out);
  return out;
}

// 9. Sprite macio radial para fumaça, vapor de Titã, gás ODM e poeira de pouso
export function getSoftPuffTexture() {
  if (texCache.has('puff')) return texCache.get('puff');
  const [c, g] = makeCanvas(128, 128);
  g.clearRect(0, 0, 128, 128);
  const grd = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  grd.addColorStop(0.0, 'rgba(255,255,255,0.92)');
  grd.addColorStop(0.35, 'rgba(250,252,255,0.58)');
  grd.addColorStop(0.70, 'rgba(240,245,250,0.18)');
  grd.addColorStop(1.0, 'rgba(240,245,250,0.0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const t = c._headless
    ? new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1)
    : new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  texCache.set('puff', t);
  return t;
}
