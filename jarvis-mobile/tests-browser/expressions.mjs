/**
 * What each expression actually looks like on his face.
 *
 * expression.test.mjs can say that `alegre` raises the cheeks and that 468
 * particles moved. It cannot say whether the result reads as a smile, or
 * whether two expressions are distinguishable at a glance on a phone. This
 * renders all nine on one sheet, and the same face quiet and talking, so a
 * human eye can settle it.
 *
 *   node tests-browser/expressions.mjs <porta> [pasta]
 */

import { chromium } from 'playwright';

const PORT = process.argv[2] ?? '8811';
const OUT = process.argv[3] ?? '/tmp';

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const page = await browser.newPage({ viewport: { width: 1000, height: 1060 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 200)));

await page.goto(`http://127.0.0.1:${PORT}`, { waitUntil: 'networkidle' });
await page.evaluate(() => document.getElementById('settings')?.close());

/**
 * Draw one grid of faces.
 *
 * @param {Array<[string, string, number]>} cells name, expression, speech level
 */
async function sheet(file, cells, columns) {
  const found = await page.evaluate(
    async ([list, cols]) => {
      const { ParticleField } = await import('./particles.js');
      const { EMOTIONS } = await import('./expression.js');

      document.getElementById('sheet')?.remove();
      const grid = document.createElement('div');
      grid.id = 'sheet';
      grid.style.cssText =
        `position:fixed;inset:0;z-index:9999;background:#05070d;display:grid;` +
        `grid-template-columns:repeat(${cols},1fr);gap:4px;padding:8px`;
      document.body.append(grid);

      const missing = [];

      // Every cell first, then the fields. A ParticleField measures its canvas
      // in the constructor, and a grid with one row in it is 1060px tall: the
      // first face came out on a buffer three times too tall, drawn small and
      // dim, and the sheet looked like the expressions were brightening.
      const canvases = [];
      for (const [label, name] of list) {
        if (name && !(name in EMOTIONS)) missing.push(name);

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
        canvases.push(canvas);
      }
      // Force the layout the constructors are about to read.
      grid.getBoundingClientRect();

      for (let i = 0; i < list.length; i += 1) {
        const [, name, loud] = list[i];
        const canvas = canvases[i];

        const field = new ParticleField(canvas, { count: 3200, shape: 'face' });
        field.setShape('face', true);
        // Settle the geometry first, with no expression, so every cell starts
        // from the same face and the only difference is the one being shown.
        for (let i = 0; i < 180; i += 1) field.frame(1 / 60);
        field.setExpression(name || 'neutro');
        field.setLevel(loud, loud ? 0.45 : 0);
        for (let i = 0; i < 150; i += 1) field.frame(1 / 60);
      }
      return missing;
    },
    [cells, columns]
  );

  if (found.length) console.log(`  AVISO: expressões desconhecidas: ${found.join(', ')}`);
  await page.screenshot({ path: `${OUT}/${file}` });
  console.log(`  ${file}`);
}

await sheet(
  'expressoes.png',
  [
    ['neutro', 'neutro', 0],
    ['atento', 'atento', 0],
    ['pensativo', 'pensativo', 0],
    ['alegre', 'alegre', 0],
    ['triste', 'triste', 0],
    ['surpreso', 'surpreso', 0],
    ['bravo', 'bravo', 0],
    ['receoso', 'receoso', 0],
    ['enojado', 'enojado', 0],
  ],
  3
);

// The point of building this on action units rather than on nine drawings:
// an expression is worn *while* he talks. Top row quiet, bottom row at voice.
// Two rows of square cells need the room: at 560 the talking row was cropped.
await page.setViewportSize({ width: 1000, height: 720 });
await sheet(
  'expressoes-falando.png',
  [
    ['alegre', 'alegre', 0],
    ['pensativo', 'pensativo', 0],
    ['receoso', 'receoso', 0],
    // 0.55, not 0.95: a vowel peak is the extreme, and at the extreme the jaw
    // swamps everything above it. What matters here is the ordinary middle of
    // a sentence, which is where the expression has to still be readable.
    ['alegre · falando', 'alegre', 0.55],
    ['pensativo · falando', 'pensativo', 0.55],
    ['receoso · falando', 'receoso', 0.55],
  ],
  3
);

console.log('erros:', errors.length ? errors.slice(0, 3) : 'nenhum');
await browser.close();
