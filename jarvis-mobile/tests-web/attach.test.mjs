/**
 * Giving him something to look at, and saying so when he cannot.
 *
 * The shape of a message changes the moment a picture is in it, and the two
 * destinations disagree about that shape: a provider takes content blocks, a
 * Jarvis backend types the field as a string and refuses them. Most of what is
 * pinned here is that the refusal explains itself, because a 422 points at
 * nothing a person can act on.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildContent, explainRefusal, fit, isImage, isText, toDataUrl } from '../web/attach.js';

// -- the message shape -------------------------------------------------------

test('no attachment means a plain string, not a list of one', () => {
  // Every backend accepts a string. Reaching for the other shape without a
  // reason would break a Jarvis for no gain.
  assert.equal(buildContent('oi', []), 'oi');
  assert.equal(buildContent('oi'), 'oi');
});

test('an image turns the message into blocks', () => {
  const content = buildContent('o que é isto?', [
    { kind: 'image', dataUrl: 'data:image/jpeg;base64,AAA' },
  ]);
  assert.ok(Array.isArray(content));
  assert.deepEqual(content[0], { type: 'text', text: 'o que é isto?' });
  assert.equal(content[1].type, 'image_url');
  assert.equal(content[1].image_url.url, 'data:image/jpeg;base64,AAA');
});

test('a picture with no words still asks something', () => {
  // An empty text block is rejected by some providers, and "here is a photo"
  // with no question is not a request anyone can answer.
  const content = buildContent('', [{ kind: 'image', dataUrl: 'data:image/jpeg;base64,A' }]);
  assert.match(content[0].text, /\S/);
});

test('several images all ride along', () => {
  const content = buildContent('compare', [
    { kind: 'image', dataUrl: 'data:1' },
    { kind: 'image', dataUrl: 'data:2' },
  ]);
  assert.equal(content.filter((part) => part.type === 'image_url').length, 2);
});

test('a text file is quoted into the message, not turned into a block', () => {
  /* Deliberate: no backend refuses a longer string, so a .csv keeps working
   * against a server that would 422 on content blocks. */
  const content = buildContent('resuma', [
    { kind: 'text', name: 'notas.md', text: 'linha um' },
  ]);
  assert.equal(typeof content, 'string');
  assert.match(content, /notas\.md/);
  assert.match(content, /linha um/);
});

test('a text file and an image together keep both', () => {
  const content = buildContent('veja', [
    { kind: 'text', name: 'a.txt', text: 'conteudo' },
    { kind: 'image', dataUrl: 'data:1' },
  ]);
  assert.ok(Array.isArray(content));
  assert.match(content[0].text, /conteudo/);
  assert.equal(content[1].type, 'image_url');
});

test('an attachment with nothing in it is ignored rather than sent empty', () => {
  assert.equal(buildContent('oi', [{ kind: 'image' }, { kind: 'text' }, null]), 'oi');
});

// -- what can be attached ----------------------------------------------------

test('the image types are the ones a model actually takes', () => {
  for (const type of ['image/png', 'image/jpeg', 'image/webp']) {
    assert.equal(isImage(type), true, type);
  }
  assert.equal(isImage('image/heic'), false, 'heic is not decodable by canvas');
  assert.equal(isImage('application/pdf'), false);
  assert.equal(isImage(undefined), false);
});

test('a file with no reported type is judged by its name', () => {
  // Browsers report '' for plenty of ordinary files, and refusing a .md
  // somebody just picked is the wrong answer.
  assert.equal(isText('', 'notas.md'), true);
  assert.equal(isText('', 'dados.csv'), true);
  assert.equal(isText('', 'foto.heic'), false);
});

test('the obvious text types are text', () => {
  for (const type of ['text/plain', 'text/markdown', 'application/json']) {
    assert.equal(isText(type), true, type);
  }
});

// -- shrinking ---------------------------------------------------------------

test('a phone photo is scaled down, keeping its proportions', () => {
  const { width, height } = fit(4000, 3000, 1280);
  assert.equal(width, 1280);
  assert.equal(height, 960);
});

test('a portrait photo is bounded by its longest edge', () => {
  const { width, height } = fit(3000, 4000, 1280);
  assert.equal(height, 1280);
  assert.equal(width, 960);
});

test('a small image is left alone rather than enlarged', () => {
  // Enlarging costs bytes on a mobile uplink and adds nothing a model uses.
  assert.deepEqual(fit(320, 240, 1280), { width: 320, height: 240 });
});

test('toDataUrl draws through a canvas at the fitted size', async () => {
  const drawn = {};
  const url = await toDataUrl(new Blob(), {
    createImageBitmap: async () => ({ width: 2560, height: 1440, close() {} }),
    makeCanvas: (width, height) => ({
      width,
      height,
      getContext: () => ({
        drawImage(_bitmap, _x, _y, w, h) {
          Object.assign(drawn, { w, h });
        },
      }),
      toDataURL: (type, quality) => `data:${type};q=${quality}`,
    }),
  });
  assert.deepEqual(drawn, { w: 1280, h: 720 });
  assert.match(url, /^data:image\/jpeg;q=0\.82$/);
});

// -- why it was refused ------------------------------------------------------

test('a backend that cannot take pictures says so, and where to change it', () => {
  /* The likeliest outcome of attaching a photo, and the one a status code
   * explains worst: OpenJarvis types the message field as a string, so the
   * image is refused before any model sees it. */
  const said = explainRefusal(422, true, true);
  assert.match(said, /não aceita imagens/);
  assert.match(said, /Onde ele pensa/, 'name the setting that fixes it');
});

test('a provider refusing is a different sentence, about the model', () => {
  const said = explainRefusal(400, true, false);
  assert.match(said, /visão/);
  assert.ok(!said.includes('Onde ele pensa'), 'the provider is not the problem');
});

test('a refusal with no picture in it is not about pictures', () => {
  assert.equal(explainRefusal(422, false, true), '');
});

test('a 500 is not this', () => {
  assert.equal(explainRefusal(500, true, true), '');
});
