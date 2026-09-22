/**
 * Making a picture with nothing configured.
 *
 * The URL *is* the request here, so almost everything worth defending is in
 * how it is built — above all that the prompt is encoded. A slash or a `#` in
 * somebody's sentence ends the path, and the failure is silent: you get a
 * different picture, or none, and nothing says why.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CAPABILITIES,
  COOLDOWN_MS,
  SIZES,
  explainFailure,
  imageUrl,
  isReady,
  newSeed,
} from '../web/generate.js';

// -- the prompt in the path --------------------------------------------------

test('a plain prompt becomes a url', () => {
  const url = new URL(imageUrl('um gato azul'));
  assert.equal(url.hostname, 'image.pollinations.ai');
  assert.match(decodeURIComponent(url.pathname), /um gato azul/);
});

test('a slash in the prompt does not end the path', () => {
  /* The silent one. "preto/branco" unencoded turns the rest into another path
   * segment, and the service renders something else entirely. */
  const url = new URL(imageUrl('foto preto/branco de um cão'));
  const afterPrefix = url.pathname.replace('/prompt/', '');
  assert.ok(!afterPrefix.includes('/'), `path still split: ${url.pathname}`);
  assert.match(decodeURIComponent(afterPrefix), /preto\/branco/);
});

test('a question mark does not become a query string', () => {
  const url = new URL(imageUrl('o que é isto? um gato'));
  assert.match(decodeURIComponent(url.pathname), /o que é isto\?/);
  assert.equal(url.searchParams.get('um gato'), null);
});

test('a hash does not truncate the prompt', () => {
  const url = new URL(imageUrl('estilo #vaporwave'));
  assert.match(decodeURIComponent(url.pathname), /#vaporwave/);
  assert.equal(url.hash, '');
});

test('accents survive the trip', () => {
  const url = new URL(imageUrl('coração à noite'));
  assert.match(decodeURIComponent(url.pathname), /coração à noite/);
});

test('an empty prompt is refused, not sent', () => {
  for (const value of ['', '   ', null, undefined]) {
    assert.throws(() => imageUrl(value), /Diga o que você quer ver/, JSON.stringify(value));
  }
});

// -- the options -------------------------------------------------------------

test('the default is square', () => {
  const url = new URL(imageUrl('x'));
  assert.equal(url.searchParams.get('width'), String(SIZES.quadrado.width));
  assert.equal(url.searchParams.get('height'), String(SIZES.quadrado.height));
});

test('a named size is used', () => {
  const url = new URL(imageUrl('x', { size: 'retrato' }));
  assert.equal(url.searchParams.get('height'), String(SIZES.retrato.height));
  assert.ok(Number(url.searchParams.get('height')) > Number(url.searchParams.get('width')));
});

test('an unknown size falls back rather than sending nonsense', () => {
  const url = new URL(imageUrl('x', { size: 'gigante' }));
  assert.equal(url.searchParams.get('width'), String(SIZES.quadrado.width));
});

test('dimensions are clamped to what the service renders', () => {
  const huge = new URL(imageUrl('x', { width: 99999, height: 99999 }));
  assert.ok(Number(huge.searchParams.get('width')) <= 1536);
  const tiny = new URL(imageUrl('x', { width: 1, height: 1 }));
  assert.ok(Number(tiny.searchParams.get('width')) >= 128);
});

test('nonsense dimensions fall back instead of reaching the wire', () => {
  const url = new URL(imageUrl('x', { width: 'grande', height: NaN }));
  assert.equal(url.searchParams.get('width'), String(SIZES.quadrado.width));
});

test('the watermark is off unless asked for', () => {
  assert.equal(new URL(imageUrl('x')).searchParams.get('nologo'), 'true');
  assert.equal(new URL(imageUrl('x', { logo: true })).searchParams.get('nologo'), null);
});

test('nothing generated here goes into a public feed', () => {
  assert.equal(new URL(imageUrl('x')).searchParams.get('private'), 'true');
});

test('a seed is passed, and only when it is a number', () => {
  assert.equal(new URL(imageUrl('x', { seed: 42 })).searchParams.get('seed'), '42');
  assert.equal(new URL(imageUrl('x', { seed: 'abc' })).searchParams.get('seed'), null);
});

test('two seeds in a row differ, or "outra" gives the same picture', () => {
  const seeds = new Set(Array.from({ length: 50 }, newSeed));
  assert.ok(seeds.size > 45, `${seeds.size} distintas de 50`);
});

// -- what is actually free ---------------------------------------------------

test('images are ready with nothing configured', () => {
  assert.equal(isReady('image'), true);
  assert.match(CAPABILITIES.image.note, /[Ss]em chave/);
});

test('video says it is not free before anybody waits for it', () => {
  /* The honest half. Video is metered by credits on the same service, and a
   * button that looks like the working one would cost a minute and a
   * failure. */
  assert.equal(isReady('video'), false);
  assert.match(CAPABILITIES.video.note, /créditos/);
});

test('an unknown kind is not ready', () => {
  assert.equal(isReady('musica'), false);
  assert.equal(isReady(undefined), false);
});

test('the cooldown matches the anonymous cap', () => {
  assert.ok(COOLDOWN_MS >= 15_000, 'pressing faster than the cap looks broken');
});

// -- failures ----------------------------------------------------------------

test('the rate cap is explained as waiting, not as an error code', () => {
  assert.match(explainFailure(429), /15 segundos/);
});

test('a busy service says to try again', () => {
  for (const status of [502, 503, 504]) {
    assert.match(explainFailure(status), /ocupado/, String(status));
  }
});

test('no connection at all is its own sentence', () => {
  assert.match(explainFailure(0), /conexão/);
});

test('anything else still names the status', () => {
  assert.match(explainFailure(418), /418/);
});
