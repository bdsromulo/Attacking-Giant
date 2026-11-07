// Procura geometrias com NaN na cena (diagnóstico).
import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
const msgs = [];
page.on('console', (m) => msgs.push(m.text()));
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 1500));
const res = await page.evaluate(async () => {
  const G = window.game;
  const check = (label) => {
    const bad = [];
    G.scene.traverse((o) => {
      const g = o.geometry;
      if (!g || !g.attributes || !g.attributes.position) return;
      const a = g.attributes.position.array;
      for (let i = 0; i < a.length; i++) if (Number.isNaN(a[i])) { bad.push({ label, type: o.type, geo: g.type, name: o.name, parent: o.parent && o.parent.type, count: a.length, params: g.parameters }); break; }
      if (o.matrixWorld && o.matrixWorld.elements.some(Number.isNaN)) bad.push({ label, type: o.type, geo: g.type, matrixNaN: true, params: g.parameters });
    });
    return bad;
  };
  const out = { menu: check('menu') };
  G.startMode('free');
  for (let i = 0; i < 30; i++) await new Promise((r) => requestAnimationFrame(r));
  out.free = check('free');
  out.info = { calls: G.renderer.info.render.calls, tris: G.renderer.info.render.triangles, geos: G.renderer.info.memory.geometries };
  return out;
});
console.log(JSON.stringify(res, null, 1).slice(0, 3000));
console.log('nan msgs:', msgs.filter((m) => m.includes('NaN')).length, '| 404:', msgs.filter((m) => m.includes('404')));
await browser.close();
