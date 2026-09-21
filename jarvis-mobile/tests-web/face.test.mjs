/**
 * Anatomy invariants for the particle face.
 *
 * These do not check that it *looks* right — only a human eye does that. They
 * check the structural facts a retune must not silently break: the silhouette
 * is a head, the depth field ranks features the way a face does, and the point
 * cloud keeps its contract with the renderer.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  LANDMARKS,
  ROLE,
  faceDepth,
  faceHalfWidth,
  sampleFace,
} from '../web/face.js';

test('the silhouette is bounded by the head', () => {
  assert.equal(faceHalfWidth(-1.2), 0, 'nothing above the crown');
  assert.equal(faceHalfWidth(1.2), 0, 'nothing below the chin');
  assert.ok(faceHalfWidth(0) > 0.5, 'widest around the cheekbones');
});

test('the head tapers from cheekbones to chin', () => {
  const cheek = faceHalfWidth(-0.1);
  const jaw = faceHalfWidth(0.55);
  const chin = faceHalfWidth(0.95);
  assert.ok(cheek > jaw, 'cheekbones wider than the jaw');
  assert.ok(jaw > chin, 'jaw wider than the chin');
});

test('the silhouette has no discontinuities', () => {
  let previous = faceHalfWidth(-0.999);
  for (let y = -0.99; y < 1; y += 0.01) {
    const current = faceHalfWidth(y);
    assert.ok(Math.abs(current - previous) < 0.05, `jump at y=${y.toFixed(2)}`);
    previous = current;
  }
});

test('the depth field ranks features like a face', () => {
  const noseTip = faceDepth(0, LANDMARKS.noseTipY);
  const cheek = faceDepth(0.4, 0.03);
  const socket = faceDepth(LANDMARKS.eyeX, LANDMARKS.eyeY);
  const temple = faceDepth(0.62, -0.4);

  assert.ok(noseTip > cheek, 'the nose is the nearest point');
  assert.ok(cheek > socket, 'eye sockets sit behind the cheekbones');
  assert.ok(cheek > temple, 'cheekbones stand proud of the temples');
});

test('the nose bridge is a ridge, not a plane', () => {
  const bridge = faceDepth(0, 0.05);
  const beside = faceDepth(0.14, 0.05);
  assert.ok(bridge > beside, 'the bridge rises above the surrounding face');
});

test('nostrils are carved into the wings of the nose', () => {
  const nostril = faceDepth(LANDMARKS.nostrilX, LANDMARKS.nostrilY);
  const wing = faceDepth(LANDMARKS.nostrilX + 0.06, LANDMARKS.nostrilY);
  assert.ok(nostril < wing, 'the nostril is a cavity');
});

test('the cloud honours the requested count exactly', () => {
  for (const count of [800, 4000, 6500]) {
    assert.equal(sampleFace(count).xs.length, count);
  }
});

test('every parallel array the renderer reads is the same length', () => {
  const face = sampleFace(2000);
  for (const key of ['ys', 'roles', 'bright', 'sizes', 'accent']) {
    assert.equal(face[key].length, face.xs.length, key);
  }
});

test('brightness stays within the renderer’s range', () => {
  const { bright } = sampleFace(3000);
  for (const value of bright) {
    assert.ok(value >= 0 && value <= 1, `out of range: ${value}`);
  }
});

test('the face carries eyes, lips and a halo', () => {
  const { roles } = sampleFace(6500);
  const tally = {};
  for (const role of roles) tally[role] = (tally[role] ?? 0) + 1;
  assert.ok(tally[ROLE.EYE] > 200, 'eyes need enough points to resolve an iris');
  assert.ok(tally[ROLE.MOUTH] > 50, 'lips must be addressable for speech');
  assert.ok(tally[ROLE.HALO] > 100, 'halo present');
  assert.ok(tally[ROLE.SKIN] > roles.length * 0.5, 'skin is the bulk');
});

test('the iris is a ring around an empty pupil centre', () => {
  const { xs, ys } = sampleFace(6500);
  const { eyeX, eyeY, irisR, pupilR } = LANDMARKS;
  let ring = 0;
  let core = 0;
  for (let i = 0; i < xs.length; i += 1) {
    const r = Math.hypot(Math.abs(xs[i]) - eyeX, ys[i] - eyeY);
    if (r < pupilR * 0.4) core += 1;
    else if (r > pupilR && r < irisR) ring += 1;
  }
  assert.ok(ring > 100, 'the iris ring is populated');
  // Not zero: a specular highlight deliberately overlaps the pupil's edge.
  assert.ok(core < ring / 8, 'the pupil reads as a void');
});

test('speech-bearing points sit on the lips', () => {
  const { xs, ys, roles } = sampleFace(6500);
  for (let i = 0; i < roles.length; i += 1) {
    if (roles[i] !== ROLE.MOUTH) continue;
    assert.ok(Math.abs(ys[i] - LANDMARKS.mouthY) < 0.2, 'lip point near the mouth');
    assert.ok(Math.abs(xs[i]) < LANDMARKS.mouthHalfW * 1.3, 'lip point within width');
  }
});

test('the layout is reproducible across calls', () => {
  const a = sampleFace(1500);
  const b = sampleFace(1500);
  for (let i = 0; i < a.xs.length; i += 97) {
    assert.equal(a.xs[i], b.xs[i]);
    assert.equal(a.bright[i], b.bright[i]);
  }
});
