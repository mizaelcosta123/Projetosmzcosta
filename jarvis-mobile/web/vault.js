/**
 * The memory, as a note an Obsidian vault can hold -- and back again.
 *
 * `memory.js` keeps its rows behind an adapter precisely so a vault can be
 * where they live one day. This is the first half of that, and the half that
 * works on a phone today: a Markdown file out, Markdown files in. Chrome on
 * Android has no directory picker, so "sync with the vault folder" is not
 * something a page can do there; a file you save into the vault, and notes
 * you pick from it, are.
 *
 * The format is plain Obsidian:
 *
 *   ---
 *   tipo: memoria-jarvis
 *   ---
 *   # Memória do Jarvis
 *   ## pedido
 *   - cria um cubo azul %%jarvis usos=2 em=2026-09-23T15:00:00.000Z%%
 *
 * `%%…%%` is Obsidian's comment syntax: hidden in reading view, so the note
 * reads as a list of what he knows, while the bookkeeping survives a round
 * trip. Any other note works as input too: every bullet, task and paragraph
 * becomes something he knows, filed as a `nota` from that file.
 */

import { episode } from './memory.js';

/** The longest line kept from an imported note. A paragraph is a memory; a
 *  chapter pasted into one line is not, and would crowd out everything else. */
export const LONGEST = 500;

const META = /\s*%%jarvis([^%]*)%%\s*$/;

/** Rows to a note. Grouped by kind, newest first within each. */
export function toMarkdown(rows, { now = () => new Date() } = {}) {
  const kinds = new Map();
  for (const row of [...rows].sort((a, b) => b.at - a.at)) {
    if (!kinds.has(row.kind)) kinds.set(row.kind, []);
    kinds.get(row.kind).push(row);
  }
  const lines = [
    '---',
    'tipo: memoria-jarvis',
    `exportado: ${now().toISOString()}`,
    `total: ${rows.length}`,
    '---',
    '',
    '# Memória do Jarvis',
    '',
    'O que ele aprendeu com você. Apague uma linha para ele esquecer, escreva',
    'uma para ele saber — e importe o arquivo de volta em Configurações → Memória.',
  ];
  for (const [kind, group] of kinds) {
    lines.push('', `## ${kind}`, '');
    for (const row of group) {
      const text = row.text.replace(/\s+/g, ' ').trim();
      lines.push(`- ${text} %%jarvis usos=${row.uses} em=${new Date(row.at).toISOString()}%%`);
    }
  }
  return `${lines.join('\n')}\n`;
}

/**
 * A note to rows.
 *
 * @param {string} text The Markdown.
 * @param {{source?: string, now?: () => number}} [options] `source` is kept
 *   on each row, so where a memory came from stays answerable.
 */
export function fromMarkdown(text, { source = '', now = () => Date.now() } = {}) {
  const rows = [];
  let kind = 'nota';
  let inFrontMatter = false;
  let inCode = false;
  // In a note this module wrote, everything before the first kind heading
  // is the title and a line of instructions to a person.
  let ours = false;
  let filed = false;
  const lines = String(text ?? '').split(/\r?\n/);
  // Front matter only counts at the very top, as in Obsidian.
  if (lines[0]?.trim() === '---') inFrontMatter = true;

  for (let i = inFrontMatter ? 1 : 0; i < lines.length; i += 1) {
    const raw = lines[i];
    const line = raw.trim();
    if (inFrontMatter) {
      if (line === '---') inFrontMatter = false;
      else if (/^tipo:\s*memoria-jarvis\b/.test(line)) ours = true;
      continue;
    }
    if (line.startsWith('```')) {
      inCode = !inCode;
      continue;
    }
    if (inCode || !line) continue;

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      // Only second-level headings name a kind: that is what `toMarkdown`
      // writes, and a note's own title is not a category.
      if (heading[1].length === 2) {
        kind = heading[2].trim().toLowerCase() || 'nota';
        filed = true;
      }
      continue;
    }
    if (ours && !filed) continue;

    let body = line
      .replace(/^[-*+]\s+\[[ xX]\]\s+/, '') // a task
      .replace(/^[-*+]\s+/, '') // a bullet
      .replace(/^\d+[.)]\s+/, '') // a numbered item
      .replace(/^>\s*/, ''); // a quote
    let uses = 0;
    let at = now();
    const meta = body.match(META);
    if (meta) {
      body = body.replace(META, '');
      uses = Number(meta[1].match(/usos=(\d+)/)?.[1] ?? 0);
      const when = Date.parse(meta[1].match(/em=(\S+)/)?.[1] ?? '');
      if (Number.isFinite(when)) at = when;
    }
    body = body.replace(/%%[\s\S]*?%%/g, '').trim();
    if (!body) continue;
    rows.push(episode({ text: body.slice(0, LONGEST), kind, at, uses, source }));
  }
  return rows;
}

/** Offer a note for download. Returns the file name. */
export function download(markdown, {
  doc = globalThis.document,
  url = globalThis.URL,
  name = `jarvis-memoria-${new Date().toISOString().slice(0, 10)}.md`,
} = {}) {
  const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
  const href = url.createObjectURL(blob);
  const link = doc.createElement('a');
  link.href = href;
  link.download = name;
  doc.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => url.revokeObjectURL(href), 1000);
  return name;
}
