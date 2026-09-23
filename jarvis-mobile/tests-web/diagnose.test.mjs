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

import { explain, providerMistake, routingRefusal } from '../web/diagnose.js';

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

// -- an aggregator that routed the request nowhere ---------------------------

const GUARDRAIL = 'openrouter engine at https://openrouter.ai/api returned 404 for '
  + '/v1/chat/completions. Make sure this port is running an OpenAI-compatible chat '
  + 'server, not another local web service. Response body: {"error":{"message":"0 '
  + 'endpoints out of 1 requested are available matching your guardrail restrictions '
  + 'and data policy. We removed them for the following reasons (an endpoint may have '
  + 'matched multiple reasons):\nProvider not allowed by guardrail: 1 endpoint excluded; '
  + 'configurable at https://openrouter.ai/workspaces/default/guardrails","code":404}}';

test('a guardrail refusal is not reported as a wrong port', () => {
  /* The status code lies. OpenRouter answers 404 when a model exists but every
     provider serving it was filtered out by the account's own rules, and the
     layer underneath reads any 404 as "this is not an OpenAI-compatible
     server". The port is fine; the request was understood. */
  const said = explain(new Error(GUARDRAIL), 'https://meu.jarvis');
  assert.doesNotMatch(said, /porta|serve outra coisa/i);
  assert.match(said, /provedor|endpoint/i);
});

test('and it hands back the link the body already carried', () => {
  // The answer was in the response the whole time, under the wrong advice.
  assert.match(explain(new Error(GUARDRAIL), ''), /openrouter\.ai\/workspaces\/default\/guardrails/);
});

test('it names the data policy when the body does', () => {
  /* Which of the two it is decides what somebody clicks: a blocked provider
     is one switch, a data policy that excludes anything that may train on
     your prompts is another — and that one is why ":free" models fail. */
  assert.match(explain(new Error(GUARDRAIL), ''), /política de dados|:free/i);
});

test('it says plainly that the app cannot fix it', () => {
  assert.match(explain(new Error(GUARDRAIL), ''), /não tem conserto aqui|painel/i);
});

test('a plain 404 is still a plain 404', () => {
  // Without both halves of the signal this must not hijack the message.
  assert.match(explain(new Error('404 Not Found'), 'https://x.test'), /respondeu 404/);
});

test('the word guardrail on its own is not enough', () => {
  /* Any provider might use it in passing. Claiming a routing failure on one
     word would replace a true message with a confident wrong one. */
  assert.equal(routingRefusal('algo sobre guardrail em outro contexto'), '');
});

test('nor is a routing failure with no policy in it', () => {
  assert.equal(routingRefusal('0 endpoints available right now'), '');
});

test('an empty or absent message is not a refusal', () => {
  for (const input of ['', null, undefined]) assert.equal(routingRefusal(input), '');
});

test('a body with no link still explains, pointing somewhere useful', () => {
  const said = routingRefusal('0 endpoints out of 2 available matching your data policy');
  assert.match(said, /https:\/\/openrouter\.ai/);
});
