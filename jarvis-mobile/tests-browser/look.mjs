/**
 * What he actually looks like, idle and at full voice, in both shapes.
 *
 * field.test.mjs can say the sphere grows and the crowded middle empties. It
 * cannot say whether the result still looks like him, or whether the expansion
 * runs off the side of a phone. This renders the real field at a real phone
 * size and leaves four PNGs to compare.
 *
 *   node tests-browser/look.mjs <porta> [pasta]
 */

import { chromium } from 'playwright';

const PORT = process.argv[2] ?? '8811';
const OUT = process.argv[3] ?? '/tmp';

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const page = await browser.newPage({ viewport: { width: 412, height: 880 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));

await page.goto(`http://127.0.0.1:${PORT}`, { waitUntil: 'networkidle' });
await page.evaluate(() => document.getElementById('settings')?.close());

// Our own canvas, on top, so the app's animation loop cannot repaint it
// underneath us mid-screenshot — which is exactly what made the first two
// captures come out identical.
await page.evaluate(() => {
  const own = document.createElement('canvas');
  own.id = 'probe';
  own.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;z-index:9999';
  document.body.append(own);
});

for (const [shape, level] of [
  ['orb', 0],
  ['orb', 0.95],
  ['face', 0],
  ['face', 0.95],
]) {
  await page.evaluate(
    async ([which, loud]) => {
      const { ParticleField } = await import('./particles.js');
      const field = new ParticleField(document.getElementById('probe'), {
        count: 6500,
        shape: which,
      });
      for (let i = 0; i < 240; i += 1) field.frame(1 / 60); // settle
      field.setLevel(loud, 0.4);
      for (let i = 0; i < 120; i += 1) field.frame(1 / 60);
    },
    [shape, level]
  );
  const name = `${shape}-${level === 0 ? 'parado' : 'falando'}.png`;
  await page.screenshot({ path: `${OUT}/${name}` });
  console.log(`  ${name}`);
}

console.log('erros:', errors.length ? errors.slice(0, 3) : 'nenhum');
await browser.close();
