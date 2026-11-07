// Teste de fumaÃ§a: abre o jogo no Chrome headless, roda os modos e simula o uso dos ganchos.
// Uso: npm run dev (em outro terminal) e depois: node tests/smoke.mjs [pasta_saida]
import puppeteer from 'puppeteer-core';
import path from 'node:path';
import fs from 'node:fs';

const OUT = process.argv[2] || 'tests/out';
fs.mkdirSync(OUT, { recursive: true });
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1280,720', '--autoplay-policy=no-user-gesture-required'],
  defaultViewport: { width: 1280, height: 720 },
  protocolTimeout: 600000,
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });

await page.goto('http://localhost:5173/', { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 2500));
await page.screenshot({ path: path.join(OUT, '01_menu.png') });

// helpers de entrada simulada
await page.evaluate(() => {
  const I = window.game.input;
  window.T = {
    press(code) { if (!I._down.has(code)) { I._down.add(code); I._pressed.add(code); } },
    release(code) { if (I._down.has(code)) { I._down.delete(code); I._released.add(code); } },
    async frames(n) { for (let i = 0; i < n; i++) await new Promise((r) => requestAnimationFrame(r)); },
    look(yaw, pitch) { const P = window.game.player; P.yaw = yaw; P.pitch = pitch; },
    snap() {
      const P = window.game.player;
      return { pos: P.pos.toArray().map((v) => +v.toFixed(1)), speed: +P.speed.toFixed(1), gas: +P.gas.toFixed(1), hooks: P.hooks.map((h) => h.state), onGround: P.onGround, hp: Math.round(P.hp) };
    },
  };
});

const log = (label, v) => console.log(label.padEnd(28), JSON.stringify(v));

// ===== ExploraÃ§Ã£o livre =====
await page.evaluate(() => window.game.startMode('free'));
await page.evaluate(() => T.frames(30));
log('free: spawn', await page.evaluate(() => T.snap()));
await page.screenshot({ path: path.join(OUT, '02_free_spawn.png') });

// mira em um prÃ©dio, dispara gancho esquerdo, recolhe com EspaÃ§o
const hookTest = await page.evaluate(async () => {
  const G = window.game, P = G.player;
  P.pos.set(-60, 1, 30); P.vel.set(0, 0, 0);
  // procura o prÃ©dio mais prÃ³ximo e mira nele
  let best = null;
  for (const c of G.world.colliders) {
    const cx = (c.min.x + c.max.x) / 2, cz = (c.min.z + c.max.z) / 2;
    const d = Math.hypot(cx - P.pos.x, cz - P.pos.z);
    if (c.max.y > 10 && d > 15 && d < 50 && (!best || d < best.d)) best = { d, cx, cz, top: c.max.y };
  }
  const dx = best.cx - P.pos.x, dz = best.cz - P.pos.z;
  T.look(Math.atan2(-dx, -dz), Math.atan2(best.top * 0.8, best.d));
  await T.frames(3);
  const aim = P.aimInfo();
  T.press('Mouse0'); await T.frames(2);
  const afterFire = T.snap();
  await T.frames(25);
  const attached = T.snap();
  T.press('Space');
  const samples = [];
  for (let i = 0; i < 6; i++) { await T.frames(10); samples.push(T.snap()); }
  T.release('Space');
  T.release('Mouse0');
  await T.frames(20);
  return { target: best, aim, afterFire, attached, samples, released: T.snap() };
});
log('hook: alvo', hookTest.target);
log('hook: mira', hookTest.aim);
log('hook: apÃ³s disparo', hookTest.afterFire);
log('hook: preso', hookTest.attached);
hookTest.samples.forEach((s, i) => log('hook: reel ' + i, s));
log('hook: solto', hookTest.released);
await page.screenshot({ path: path.join(OUT, '03_after_reel.png') });

// balanÃ§o: gancho alto + W
const swing = await page.evaluate(async () => {
  const G = window.game, P = G.player;
  // perto da torre central (0, 0..62, 0), mirando no topo
  P.pos.set(30, 25, 30); P.vel.set(0, 0, 0);
  const d = { x: -30, y: 15, z: -30 };
  T.look(Math.atan2(-d.x, -d.z), Math.atan2(d.y, Math.hypot(d.x, d.z)));
  await T.frames(2);
  const aim = P.aimInfo();
  T.press('Mouse2'); await T.frames(30);
  const out = [];
  for (let i = 0; i < 8; i++) { await T.frames(10); out.push(T.snap()); }
  T.release('Mouse2'); await T.frames(5);
  return [aim, ...out];
});
swing.forEach((s, i) => log('swing ' + i, s));

// burst: duplo toque W no ar
const burst = await page.evaluate(async () => {
  const P = window.game.player;
  P.pos.set(-20, 40, 0); P.vel.set(0, 0, 0);
  T.look(0, 0);
  await T.frames(2);
  T.press('KeyW'); await T.frames(1); T.release('KeyW'); await T.frames(1);
  window.game.input._lastTap.set('KeyW', performance.now());
  window.game.input._double.add('KeyW');
  T.press('KeyW');
  const a = [];
  for (let i = 0; i < 4; i++) { await T.frames(8); a.push(T.snap()); }
  T.release('KeyW');
  return { a, stress: P.stress };
});
burst.a.forEach((s, i) => log('burst ' + i, s));
log('burst stress', burst.stress);

// ===== SobrevivÃªncia =====
await page.evaluate(() => window.game.startMode('survival'));
await new Promise((r) => setTimeout(r, 5500));
const surv = await page.evaluate(() => ({ wave: window.game.wave, giants: window.game.giants.giants.length, types: window.game.giants.giants.map((g) => g.typeKey) }));
log('survival', surv);
// teleporta para perto de um gigante e testa o lunge
const lunge = await page.evaluate(async () => {
  const G = window.game, P = G.player;
  const g = G.giants.giants[0];
  g.alwaysChase = false; g.state = 'wander'; g.speedMul = 0;
  await T.frames(2);
  const nape = g.m.nape.getWorldPosition(new g.pos.constructor());
  // fica atrÃ¡s do gigante, olhando para a nuca
  const back = { x: -Math.sin(g.heading), z: -Math.cos(g.heading) };
  P.pos.set(nape.x + back.x * 9, nape.y + 2, nape.z + back.z * 9); P.vel.set(0, 0, 0);
  const d = nape.clone().sub(P.pos);
  T.look(Math.atan2(-d.x, -d.z), Math.atan2(d.y, Math.hypot(d.x, d.z)));
  await T.frames(3);
  T.press('KeyF'); await T.frames(2); T.release('KeyF');
  await T.frames(2);
  const target = P.lungeTarget ? P.lungeTarget.zone : null;
  T.press('Mouse0'); await T.frames(2); T.release('Mouse0');
  await T.frames(40);
  return { target, alive: g.alive, state: g.state, score: G.score, poised: P.poised };
});
log('lunge', lunge);
await page.screenshot({ path: path.join(OUT, '04_survival.png') });

// ===== Corrida e Treino =====
await page.evaluate(() => window.game.startMode('race'));
await new Promise((r) => setTimeout(r, 1500));
await page.screenshot({ path: path.join(OUT, '05_race.png') });
await page.evaluate(() => window.game.startMode('training'));
await new Promise((r) => setTimeout(r, 1500));
await page.screenshot({ path: path.join(OUT, '06_training.png') });

const fps = await page.evaluate(async () => {
  const t0 = performance.now(); await T.frames(60); return Math.round(60000 / (performance.now() - t0));
});
log('fps (swiftshader)', fps);
log('render', await page.evaluate(() => ({ calls: window.game.renderer.info.render.calls, tris: window.game.renderer.info.render.triangles })));
console.log('\nERROS:', errors.length ? '\n' + errors.join('\n') : 'nenhum');
await browser.close();
