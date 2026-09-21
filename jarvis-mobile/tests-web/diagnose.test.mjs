/**
 * The settings sheet's two addresses.
 *
 * `Failed to fetch` was the first thing a real user saw after a successful
 * deploy, because the Servidor field took the provider's URL without
 * complaint. These tests pin the two behaviours that prevent a repeat: the
 * provider is recognised before it is saved, and a dead fetch says which
 * field to look at.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { explain, providerMistake } from '../web/diagnose.js';

test('a provider URL is named, whatever path it carries', () => {
  for (const url of [
    'https://openrouter.ai/api/v1/',
    'https://openrouter.ai',
    'https://router.huggingface.co/v1',
    'https://inference-api.nousresearch.com/v1',
    'https://opencode.ai/zen',
    'https://api.openai.com/v1',
  ]) {
    assert.notEqual(providerMistake(url), '', url);
  }
});

test('a real backend is left alone', () => {
  for (const url of [
    '',
    '   ',
    'https://jarvis-backend-rhnc.onrender.com',
    'http://localhost:8000',
    'http://127.0.0.1:10000/',
    'https://jarvis.example.com',
  ]) {
    assert.equal(providerMistake(url), '', url);
  }
});

test('a lookalike host is not a provider', () => {
  // Endswith matching must respect the dot: `notopenrouter.ai` is somebody
  // else's domain, and rejecting it would block a legitimate backend.
  assert.equal(providerMistake('https://notopenrouter.ai'), '');
  assert.equal(providerMistake('https://openrouter.ai.evil.test'), '');
});

test('garbage in the field is not treated as a provider', () => {
  assert.equal(providerMistake('nao-e-uma-url'), '');
});

test('a blocked fetch names the field, not the browser message', () => {
  const said = explain(new TypeError('Failed to fetch'), 'https://openrouter.ai');
  assert.match(said, /Servidor/);
  assert.match(said, /provedor/);
  assert.match(said, /openrouter\.ai/);
  assert.doesNotMatch(said, /Failed to fetch/);
});

test('401 points at the right key', () => {
  const said = explain(new Error('401 Unauthorized'), 'https://jarvis.example.com');
  assert.match(said, /OPENJARVIS_API_KEY/);
});

test('an error it cannot classify is passed through unchanged', () => {
  assert.equal(explain(new Error('500 Internal Server Error'), 'x'), '500 Internal Server Error');
});

test('an empty error still says something', () => {
  assert.notEqual(explain(new Error(''), ''), '');
});
