/**
 * Running what he wrote, without letting it touch anything.
 *
 * Most of this is finding the right block. The part that matters is the
 * sandbox: rendering a model's page means executing its script on the same
 * screen as the provider key, and one wrong attribute is the difference
 * between an opaque origin and this one.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SANDBOX,
  asDocument,
  codeBlocks,
  describe,
  escapesSandbox,
  previewable,
} from '../web/preview.js';

// -- the sandbox -------------------------------------------------------------

test('the frame runs scripts and is not in this origin', () => {
  /* The pair that matters. With allow-same-origin as well, the framed script
   * could read localStorage — where the provider key lives — and reach into
   * the document. Apart, it can do neither. */
  assert.ok(SANDBOX.includes('allow-scripts'));
  assert.ok(!SANDBOX.includes('allow-same-origin'));
});

test('escapesSandbox names the combination that would be a hole', () => {
  assert.equal(escapesSandbox('allow-scripts allow-same-origin'), true);
  assert.equal(escapesSandbox(SANDBOX), false);
  assert.equal(escapesSandbox('allow-same-origin'), false, 'no scripts, no escape');
  assert.equal(escapesSandbox(''), false);
  assert.equal(escapesSandbox(null), false);
});

// -- finding the code --------------------------------------------------------

test('a fenced block comes back with its language', () => {
  const blocks = codeBlocks('antes\n```html\n<p>oi</p>\n```\ndepois');
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].language, 'html');
  assert.match(blocks[0].code, /<p>oi<\/p>/);
});

test('two blocks do not become one', () => {
  // A non-greedy fence, or everything between the first and last ``` is code.
  const blocks = codeBlocks('```js\num\n```\ntexto\n```js\ndois\n```');
  assert.equal(blocks.length, 2);
  assert.match(blocks[0].code, /um/);
  assert.match(blocks[1].code, /dois/);
});

test('a block with no language is still a block', () => {
  assert.equal(codeBlocks('```\nalgo\n```')[0].language, '');
});

test('an empty fence is not a block', () => {
  assert.deepEqual(codeBlocks('```html\n\n```'), []);
});

test('prose with no fences has no blocks', () => {
  assert.deepEqual(codeBlocks('só texto, sem código'), []);
  assert.deepEqual(codeBlocks(''), []);
  assert.deepEqual(codeBlocks(null), []);
});

// -- choosing one ------------------------------------------------------------

test('only html and svg are offered to run', () => {
  assert.equal(previewable('```python\nprint(1)\n```'), null);
  assert.equal(previewable('```js\nalert(1)\n```'), null, 'a script is not a page');
  assert.ok(previewable('```html\n<p>x</p>\n```'));
  assert.ok(previewable('```svg\n<svg/>\n```'));
});

test('the last runnable block wins', () => {
  /* A reply that shows a broken version and then the fix means the fix, and
   * reading top-down would render the broken one. */
  const block = previewable('```html\n<p>errado</p>\n```\nagora certo:\n```html\n<p>certo</p>\n```');
  assert.match(block.code, /certo/);
  assert.ok(!block.code.includes('errado'));
});

test('a runnable block after an unrunnable one is still found', () => {
  const block = previewable('```py\nx\n```\n```html\n<b>oi</b>\n```');
  assert.match(block.code, /oi/);
});

// -- what gets rendered ------------------------------------------------------

test('a whole document is passed through untouched', () => {
  const code = '<!DOCTYPE html><html><body>já completo</body></html>';
  assert.equal(asDocument({ language: 'html', code }), code);
});

test('a fragment is wrapped into a document', () => {
  // Models answer with a bare div and a style at least as often as with a
  // full page, and a fragment alone renders unstyled and white.
  const html = asDocument({ language: 'html', code: '<div>pedaço</div>' });
  assert.match(html, /<!DOCTYPE html>/);
  assert.match(html, /pedaço/);
});

test('the wrapper is dark, because the fragment inherits nothing', () => {
  const html = asDocument({ language: 'html', code: '<p>x</p>' });
  assert.match(html, /background/);
  assert.match(html, /color-scheme: dark/);
});

test('an svg is wrapped rather than served as a document', () => {
  const html = asDocument({ language: 'svg', code: '<svg viewBox="0 0 10 10"/>' });
  assert.match(html, /<!DOCTYPE html>/);
  assert.match(html, /<svg/);
});

test('nonsense does not throw', () => {
  assert.equal(typeof asDocument(null), 'string');
  assert.equal(typeof asDocument({}), 'string');
});

test('the button says what will happen', () => {
  assert.match(describe({ language: 'html' }), /página/);
  assert.match(describe({ language: 'svg' }), /desenho/);
  assert.equal(describe(null), '');
});
