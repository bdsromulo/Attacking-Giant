// Screenshot de todos os tipos de gigante lado a lado (validação visual dos modelos).
import puppeteer from 'puppeteer-core';
import path from 'node:path';
const OUT = process.argv[2] || 'tests/out';
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'], defaultViewport: { width: 1280, height: 720 } });
const page = await browser.newPage();
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 1500));
await page.evaluate(async () => {
  const G = window.game;
  document.getElementById('menu').classList.add('hidden');
  G.giants.clear();
  G.state = 'debug';
  const types = ['pequeno', 'comum', 'errante', 'blindado', 'colosso'];
  let x = -150;
  for (const t of types) {
    const g = G.giants.spawn(t, x, -130);
    g.heading = 0.5; g.root.rotation.y = 0.5;
    g.root.updateMatrixWorld(true);
    x += t === 'colosso' ? 0 : 22;
  }
  G.camera.fov = 60; G.camera.updateProjectionMatrix();
  G.camera.position.set(-120, 16, -78);
  G.camera.lookAt(-105, 12, -130);
  G.sun.target.position.set(-110, 0, -130); G.sun.position.set(-110 - 100, 180, -130 + 80);
  for (let i = 0; i < 5; i++) await new Promise((r) => requestAnimationFrame(r));
});
await page.screenshot({ path: path.join(OUT, 'giants_lineup.png') });
// close no rosto e na nuca de um comum
await page.evaluate(async () => {
  const G = window.game;
  const g = G.giants.giants[1];
  const head = g.m.head.getWorldPosition(g.pos.clone());
  G.camera.position.set(head.x + 5, head.y + 1, head.z + 9);
  G.camera.lookAt(head);
  for (let i = 0; i < 3; i++) await new Promise((r) => requestAnimationFrame(r));
});
await page.screenshot({ path: path.join(OUT, 'giant_face.png') });
await page.evaluate(async () => {
  const G = window.game;
  const g = G.giants.giants[1];
  const n = g.m.nape.getWorldPosition(g.pos.clone());
  G.camera.position.set(n.x - Math.sin(g.heading) * 6 + 2, n.y + 2, n.z - Math.cos(g.heading) * 6);
  G.camera.lookAt(n);
  for (let i = 0; i < 3; i++) await new Promise((r) => requestAnimationFrame(r));
});
await page.screenshot({ path: path.join(OUT, 'giant_nape.png') });
await browser.close();
console.log('ok');
