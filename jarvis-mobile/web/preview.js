/**
 * Running what he wrote, without letting it touch anything.
 *
 * Asking a model for a page and then reading the source is not seeing it. This
 * takes a fenced block out of the reply and renders it — which means executing
 * code that a model wrote, on the same screen as the API key.
 *
 * The whole safety of this is one attribute pair. The frame gets
 * `sandbox="allow-scripts"` and **not** `allow-same-origin`: together those two
 * would put the frame in this page's origin, where its script could read
 * `localStorage` — the provider key lives there — and reach into the document.
 * Apart, the frame runs in an opaque origin that can do neither. There is no
 * third option that runs scripts safely, so this is not a setting.
 */

/** Languages worth offering to run. Anything else is code to read, not a page. */
const RUNNABLE = new Set(['html', 'svg']);

/** Fenced blocks in a reply, in order. */
export function codeBlocks(reply) {
  const blocks = [];
  // Three or more backticks, an optional language, then everything up to the
  // matching fence. Non-greedy so two blocks do not become one.
  const fence = /```([\w+-]*)[^\S\n]*\n([\s\S]*?)```/g;
  let match = fence.exec(String(reply ?? ''));
  while (match !== null) {
    const language = match[1].toLowerCase();
    const code = match[2];
    if (code.trim()) blocks.push({ language, code });
    match = fence.exec(String(reply ?? ''));
  }
  return blocks;
}

/**
 * The block to preview, if any.
 *
 * The last runnable one: a reply that shows a first attempt and then a fixed
 * version means the second, and reading top-down would show the broken one.
 */
export function previewable(reply) {
  const runnable = codeBlocks(reply).filter((block) => RUNNABLE.has(block.language));
  return runnable.length ? runnable[runnable.length - 1] : null;
}

/**
 * Wrap a fragment into a document the frame can render.
 *
 * A model asked for "a page" often answers with a full document, and often
 * with just a `<div>` and a `<style>`. Both have to work, so anything without
 * an `<html>` gets one — with a dark background, because the fragment inherits
 * nothing from this page and white would flash.
 */
export function asDocument(block) {
  const code = String(block?.code ?? '');
  if (block?.language === 'svg') {
    return wrap(code);
  }
  if (/<html[\s>]/i.test(code)) return code;
  return wrap(code);
}

function wrap(body) {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root { color-scheme: dark; }
  html, body { margin: 0; background: #0b1017; color: #e6edf5;
    font: 16px/1.5 system-ui, sans-serif; }
  body { padding: 1rem; }
</style>
</head>
<body>
${body}
</body>
</html>`;
}

/**
 * The sandbox tokens the frame must carry.
 *
 * Exported so a test can assert the pair rather than trusting a string in the
 * markup: the failure mode is silent, and it is the difference between running
 * a model's code and handing it the API key.
 */
export const SANDBOX = 'allow-scripts';

/** True when this set of tokens would let framed code reach this origin. */
export function escapesSandbox(tokens) {
  const parts = String(tokens ?? '').split(/\s+/).filter(Boolean);
  return parts.includes('allow-scripts') && parts.includes('allow-same-origin');
}

/** A short label for the button, so it says what will run. */
export function describe(block) {
  if (!block) return '';
  return block.language === 'svg' ? 'Ver o desenho' : 'Ver a página';
}
