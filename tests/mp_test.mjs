// Teste de Multiplayer P2P (Listen Server + Topologia Estrela + Link ?room= + Migração de Host)
import puppeteer from 'puppeteer-core';
import { createServer } from 'vite';
import path from 'node:path';
import fs from 'node:fs';

const OUT = process.argv[2] || 'tests/out';
fs.mkdirSync(OUT, { recursive: true });
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const viteServer = await createServer({ server: { port: 5173, strictPort: false } });
await viteServer.listen();
const port = viteServer.config.server.port || 5173;
const BASE_URL = `http://localhost:${port}/`;

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1280,720', '--autoplay-policy=no-user-gesture-required'],
  defaultViewport: { width: 1280, height: 720 },
  protocolTimeout: 30000,
});

const pageHost = await browser.newPage();

const errors = [];
for (const [lbl, p] of [['HOST', pageHost]]) {
  p.on('pageerror', (e) => { console.log(`${lbl} pageerror:`, e.message); errors.push(`${lbl} pageerror: ${e.message}`); });
  p.on('console', (m) => {
    console.log(`[${lbl} console.${m.type()}]`, m.text());
    if (m.type() === 'error') errors.push(`${lbl} error: ${m.text()}`);
  });
}

console.log('1. Navigating pageHost to', BASE_URL);
await pageHost.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
console.log('2. Waiting for window.game...');
await pageHost.waitForFunction(() => !!window.game && !!window.game.net);
console.log('3. window.game ready!');
await new Promise((r) => setTimeout(r, 800));

// 1. Abre o painel Multiplayer P2P no menu principal
console.log('4. Clicking #btnMenuMp...');
await pageHost.click('#btnMenuMp');
await pageHost.evaluate(() => {
  window.game.net.setNickname('Levi_Host');
  document.getElementById('mpName').value = 'Levi_Host';
});
await new Promise((r) => setTimeout(r, 400));
await pageHost.screenshot({ path: path.join(OUT, 'mp_01_menu_panel.png') });

// 2. Host cria sala P2P e entra no modo survival
const roomCode = await pageHost.evaluate(() => {
  const code = window.game.net.createRoom('survival', true);
  window.game.startMode('survival', true);
  return code;
});
console.log('Room created by Host:', roomCode);

// 3. Cliente entra direto pelo link ?room=CODIGO (fluxo estilo Jackbox)
const pageClient = await browser.newPage();
pageClient.on('pageerror', (e) => { console.log('CLIENT pageerror:', e.message); errors.push(`CLIENT pageerror: ${e.message}`); });
pageClient.on('console', (m) => {
  console.log(`[CLIENT console.${m.type()}]`, m.text());
  if (m.type() === 'error') errors.push(`CLIENT error: ${m.text()}`);
});
await pageClient.goto(`${BASE_URL}?room=${roomCode}`, { waitUntil: 'domcontentloaded' });
await pageClient.waitForFunction(() => !!window.game && !!window.game.net);
await new Promise((r) => setTimeout(r, 600));
await pageClient.evaluate(() => {
  window.game.net.setNickname('Mikasa_P2P');
  window.game.player.setSkin('guarda');
  window.game.player.setWeapon('spears');
});

// Aguarda handshake e sincronização P2P entre Host e Cliente
await new Promise((r) => setTimeout(r, 1500));

// 4. Posiciona Host e Cliente frente a frente na avenida central com um Titã Blindado próximo
await pageHost.evaluate(() => {
  const G = window.game, P = G.player;
  G.state = 'playing';
  G.showScreen(null);
  G.hud.show(true);
  G.hud.bigMsg('', '', 0.01);
  clearTimeout(G.pendingT);
  G.waveSpawning = false;
  G.giants.clear();
  const g = G.giants.spawn('blindado', -20, -22);
  g.heading = 0;
  g.root.rotation.y = 0;
  g.state = 'idle';
  P.pos.set(-20, 1.2, 2);
  P.vel.set(0, 0, 0);
  P.yaw = 0;
  P.pitch = -0.05;
  P.poised = true;
});

await pageClient.evaluate(() => {
  const G = window.game, P = G.player;
  G.state = 'playing';
  G.showScreen(null);
  G.hud.show(true);
  G.hud.bigMsg('', '', 0.01);
  P.pos.set(-18.5, 1.2, -5.5);
  P.vel.set(0, 0, 0);
  P.yaw = 2.85;
  P.pitch = -0.04;
  P.poised = true;
  P.emoteIdx = 0;
  P.emoteT = 5.0; // Saudação "Entregar o Coração!"
});

// Roda alguns quadros para interpolação de rede
await new Promise((r) => setTimeout(r, 1000));

const syncStatus = await pageClient.evaluate(() => {
  const G = window.game;
  return {
    active: G.net.active,
    isHost: G.net.isHost,
    roomCode: G.net.roomCode,
    playerCount: G.net.playerCount,
    remoteNames: Array.from(G.net.remotes.values()).map((r) => r.name),
    syncedGiants: G.giants.giants.map((g) => ({ id: g.id, type: g.typeKey, h: +g.H.toFixed(1) })),
  };
});
console.log('Client P2P Sync Status:', JSON.stringify(syncStatus));

await pageHost.screenshot({ path: path.join(OUT, 'mp_02_host_view.png') });
await pageClient.screenshot({ path: path.join(OUT, 'mp_03_client_view.png') });

// 5. Testa o Placar Multiplayer (Tab) no Host
await pageHost.evaluate(() => {
  window.game.input._down.add(window.game.settings.keys.scoreboard);
});
await new Promise((r) => setTimeout(r, 250));
await pageHost.screenshot({ path: path.join(OUT, 'mp_04_scoreboard.png') });
await pageHost.evaluate(() => {
  window.game.input._down.delete(window.game.settings.keys.scoreboard);
});

// 5b. Close-up da Capa da Patrulha com o Brasão das Asas da Liberdade no modelo 3D do jogador
await pageHost.evaluate(() => {
  const G = window.game, P = G.player;
  G.state = 'debug';
  G.hud.show(false);
  P.model.group.position.set(-20, 1.5, 0);
  P.model.group.rotation.y = 0.25;
  P.model.cape.rotation.x = 0.22;
  P.model.cape2.rotation.x = 0.15;
  G.camera.fov = 38;
  G.camera.updateProjectionMatrix();
  G.camera.position.set(-19.2, 2.55, -2.4);
  G.camera.lookAt(-20, 2.25, 0);
});
await new Promise((r) => setTimeout(r, 200));
await pageHost.screenshot({ path: path.join(OUT, 'player_cape_3d.png') });
await pageHost.evaluate(() => {
  window.game.state = 'playing';
  window.game.hud.show(true);
});

// 6. Testa resolução de acerto Cliente -> Host (Listen Server)
const hitResult = await pageClient.evaluate(async () => {
  const G = window.game;
  const g = G.giants.giants[0];
  if (!g) return { err: 'no giant on client' };
  // Quebra armadura e corta a nuca via requisição P2P ao Host
  G.net.sendHitRequest(g, 'nape', 999, g.pos);
  await new Promise((r) => setTimeout(r, 200));
  G.net.sendHitRequest(g, 'nape', 999, g.pos);
  await new Promise((r) => setTimeout(r, 400));
  return {
    clientScore: G.score,
    clientKills: G.stats.kills,
    giantAlive: g.alive,
  };
});
console.log('Client->Host Hit Resolution:', JSON.stringify(hitResult));

// 7. Testa Migração Automática de Host quando o Host sai / desconecta
await pageHost.evaluate(() => { window.game.net.leaveRoom(false); });
await new Promise((r) => setTimeout(r, 500));
const migrationStatus = await pageClient.evaluate(() => ({
  isHostAfterMigration: window.game.net.isHost,
  hostId: window.game.net.hostId,
  localId: window.game.net.localId,
}));
console.log('Host Migration Result:', JSON.stringify(migrationStatus));

await browser.close();
await viteServer.close();

if (errors.length) {
  console.log('CONSOLE ERRORS:', errors);
  process.exit(1);
}
if (!syncStatus.active || syncStatus.playerCount < 2 || syncStatus.syncedGiants.length < 1 || !migrationStatus.isHostAfterMigration) {
  console.error('MP TEST FAILED ASSERTIONS');
  process.exit(1);
}
console.log('MP TEST OK');
