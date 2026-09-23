/**
 * The memory section: see what he learned, take it back, and move it in
 * and out of an Obsidian vault as a note.
 *
 * The export is read from the real download, and the import goes through
 * the real file input -- the two places a unit test cannot reach.
 *
 *   cd web && python3 -m http.server 8811 &
 *   node tests-browser/memory.mjs
 */

import { chromium } from 'playwright';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const UI = process.argv[2] ?? 'http://127.0.0.1:8811';

let failures = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'ok' : 'FALHOU'}  ${label}`);
  if (!ok) console.log(`        esperado ${JSON.stringify(want)}\n        veio     ${JSON.stringify(got)}`);
};

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const ctx = await browser.newContext({ viewport: { width: 412, height: 880 }, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
page.on('dialog', (dialog) => dialog.accept());

await page.goto(UI, { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.setItem('jarvis.settings.v1', JSON.stringify({
  providers: [{ id: 'p1', name: 'X', url: 'http://127.0.0.1:59999', key: '', kind: 'openai', agent: false }],
  active: 'p1', model: '', speak: false, wake: false,
})));
await page.reload({ waitUntil: 'networkidle' });
await page.evaluate(() => document.getElementById('settings')?.close());

// Things he learns without any model: requests made on the fast path, and a
// taught name.
for (const text of ['cria um cubo azul', 'quando eu disser caixote é um cubo', 'uma esfera roxa']) {
  await page.fill('#prompt', text);
  await page.press('#prompt', 'Enter');
  await page.waitForTimeout(250);
}

const open = async () => {
  await page.evaluate(() => document.getElementById('settings').open || document.getElementById('menu').click());
  await page.waitForTimeout(250);
};
const listed = () => page.$$eval('#memory-list li span', (spans) => spans.map((s) => s.textContent));
const state = () => page.$eval('#memory-state', (n) => n.textContent);

console.log('\nver o que ele aprendeu');
await open();
check('a lista mostra, a mais nova primeiro', await listed(),
  ['uma esfera roxa', 'quando eu disser caixote é um cubo', 'cria um cubo azul']);
check('o resumo conta por tipo', /3 lembranças: .*2 pedido.*1 apelido|3 lembranças: .*1 apelido.*2 pedido/.test(await state()), true);

console.log('\nexportar para o Obsidian');
const [download] = await Promise.all([page.waitForEvent('download'), page.click('#memory-export')]);
const dir = mkdtempSync(join(tmpdir(), 'jarvis-vault-'));
const saved = join(dir, download.suggestedFilename());
await download.saveAs(saved);
const note = readFileSync(saved, 'utf8');
check('um arquivo .md', /^jarvis-memoria-\d{4}-\d{2}-\d{2}\.md$/.test(download.suggestedFilename()), true);
check('com front matter de nota', note.startsWith('---\ntipo: memoria-jarvis\n'), true);
check('e as lembranças dentro', ['cria um cubo azul', 'caixote', 'uma esfera roxa'].every((t) => note.includes(t)), true);

console.log('\nesquecer uma');
await page.click('#memory-list li:first-child button');
await page.waitForTimeout(150);
check('sumiu da lista', await listed(), ['quando eu disser caixote é um cubo', 'cria um cubo azul']);

console.log('\nimportar notas');
const casa = join(dir, 'casa.md');
writeFileSync(casa, '# Casa\n- prefiro café sem açúcar\n- [ ] comprar lâmpadas\n');
await page.setInputFiles('#memory-file', [saved, casa]);
await page.waitForTimeout(400);
check('duas notas lidas, e só o que era novo entrou', /2 notas lidas, 3 lembranças novas/.test(await state()), true);
const after = await listed();
check('o esquecido voltou pelo arquivo exportado antes', after.includes('uma esfera roxa'), true);
check('e a nota do vault virou lembrança', after.includes('prefiro café sem açúcar'), true);

console.log('\no que foi importado é usado');
// The fast path answers "caixote" only if the taught name came back.
await page.evaluate(() => document.getElementById('settings').close());
await page.waitForTimeout(150);
await page.evaluate(() => localStorage.setItem('jarvis.memory.v1', localStorage.getItem('jarvis.memory.v1')));
await page.reload({ waitUntil: 'networkidle' });
await page.evaluate(() => document.getElementById('settings')?.close());
await page.fill('#prompt', 'poe um caixote aqui');
await page.press('#prompt', 'Enter');
await page.waitForTimeout(300);
check('o nome ensinado continua valendo depois de recarregar',
  await page.$eval('#caption', (n) => n.textContent.trim()), 'Um cubo.');

console.log('\nesquecer tudo');
await open();
await page.click('#memory-forget');
await page.waitForTimeout(200);
check('a lista esvaziou', await listed(), []);
check('e o armazenamento também',
  await page.evaluate(() => JSON.parse(localStorage.getItem('jarvis.memory.v1') ?? '[]').length), 0);
check('sem nada, exportar fica desligado', await page.$eval('#memory-export', (b) => b.disabled), true);

console.log('\nerros:', errors.length ? [...new Set(errors)] : 'nenhum');
if (errors.length) failures += 1;
console.log(failures ? `\n${failures} falha(s)` : '\ntudo certo');
await browser.close();
process.exit(failures ? 1 : 0);
