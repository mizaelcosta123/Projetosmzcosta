/**
 * Where he looks, and what his head does about it.
 *
 * gaze.test.mjs proves the numbers: the eye jumps, the head lags, the eyes
 * counter-rotate. It cannot say whether an iris that has moved 0.05 units is
 * visibly looking at anything, or whether a head at 0.5 radians of yaw still
 * reads as the same face. This draws it.
 *
 *   node tests-browser/gaze.mjs <porta> [pasta]
 */

import { chromium } from 'playwright';

const PORT = process.argv[2] ?? '8811';
const OUT = process.argv[3] ?? '/tmp';

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const page = await browser.newPage({ viewport: { width: 1000, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));

await page.goto(`http://127.0.0.1:${PORT}`, { waitUntil: 'networkidle' });
await page.evaluate(() => document.getElementById('settings')?.close());

/**
 * @param {Array<[string, number, number]>} cells label, gaze x, gaze y
 */
async function sheet(file, cells, columns) {
  await page.evaluate(
    async ([list, cols]) => {
      const { ParticleField } = await import('./particles.js');

      document.getElementById('sheet')?.remove();
      const grid = document.createElement('div');
      grid.id = 'sheet';
      grid.style.cssText =
        `position:fixed;inset:0;z-index:9999;background:#05070d;display:grid;` +
        `grid-template-columns:repeat(${cols},1fr);gap:4px;padding:8px;` +
        // Without this the row stretches to the viewport and the cells take
        // their height from it, so aspect-ratio ends up setting a width wider
        // than the column and the last one falls off the sheet.
        `align-items:start`;
      document.body.append(grid);

      // Every cell before any field, so each canvas is measured against the
      // finished grid rather than a one-row one three times too tall.
      const canvases = list.map(([label]) => {
        const cell = document.createElement('div');
        cell.style.cssText = 'position:relative;aspect-ratio:1';
        const canvas = document.createElement('canvas');
        canvas.style.cssText = 'width:100%;height:100%;display:block';
        const tag = document.createElement('span');
        tag.textContent = label;
        tag.style.cssText =
          'position:absolute;left:8px;bottom:6px;font:13px system-ui;color:#8fb4ff;' +
          'letter-spacing:.06em;text-transform:uppercase';
        cell.append(canvas, tag);
        grid.append(cell);
        return canvas;
      });
      grid.getBoundingClientRect();

      list.forEach(([, gx, gy, roll], i) => {
        const field = new ParticleField(canvases[i], { count: 3600, shape: 'face' });
        field.setShape('face', true);
        for (let k = 0; k < 150; k += 1) field.frame(1 / 60);
        if (roll) {
          field.gaze.rollEyes(field.time * 1000);
          // 250ms in: up and over, the furthest point of the arc. Earlier and
          // the eye is still on its way up; later and it is already coming
          // back down the far side.
          for (let k = 0; k < 15; k += 1) field.frame(1 / 60);
        } else {
          field.gaze.at(gx, gy);
          // Long enough for the head to have caught up with the eyes.
          for (let k = 0; k < 150; k += 1) field.frame(1 / 60);
        }
      });
    },
    [cells, columns]
  );
  await page.screenshot({ path: `${OUT}/${file}` });
  console.log(`  ${file}`);
}

await sheet(
  'olhar.png',
  [
    ['olhando à esquerda', -0.9, 0],
    ['de frente', 0, 0],
    ['olhando à direita', 0.9, 0],
    ['para cima', 0, -0.85],
    ['revirando os olhos', 0, 0, true],
    ['para baixo', 0, 0.8],
  ],
  3
);

// The same four, cropped to the eyes. At head size an iris is a dozen dots
// and "it moved" is a matter of opinion; at this scale it is not.
await page.setViewportSize({ width: 1200, height: 400 });
await sheet(
  'olhos.png',
  [
    ['esquerda', -0.9, 0],
    ['centro', 0, 0],
    ['direita', 0.9, 0],
    ['revirando', 0, 0, true],
  ],
  4
);
await page.screenshot({
  path: `${OUT}/olhos-perto.png`,
  clip: { x: 0, y: 100, width: 1200, height: 120 },
});
console.log('  olhos-perto.png');

console.log('erros:', errors.length ? errors.slice(0, 3) : 'nenhum');
await browser.close();
