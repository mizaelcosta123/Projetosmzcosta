/**
 * Saying what the phone can do, and not saying more than is true.
 *
 * "Connected" is not one state. A linked runner enforces a policy that was
 * typed on the device; an SSH target is a full shell; a runner from before the
 * screen tools is connected and cannot tap anything. Flattening those into one
 * green line is how somebody ends up asking for something that will not work.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { details, fetchDevice, summarize } from '../web/device.js';

const reply = (status, payload) => ({
  status,
  ok: status >= 200 && status < 300,
  json: async () => payload,
});

// -- reading it --------------------------------------------------------------

test('a good answer comes back as it is', async () => {
  const state = await fetchDevice('http://x', {}, async () =>
    reply(200, { linked: true, name: 'pixel', transport: 'bridge' })
  );
  assert.equal(state.name, 'pixel');
});

test('a page of HTML is not a device status', async () => {
  /* The old bug: the catch-all route answered /v1/device with the interface,
   * 200 and all. It reads as working and tells you nothing. */
  await assert.rejects(
    () => fetchDevice('http://x', {}, async () => reply(200, null)),
    /não é o estado do aparelho/
  );
});

test('a 404 names the real cause, which is the deploy', async () => {
  await assert.rejects(
    () => fetchDevice('http://x', {}, async () => reply(404)),
    /anterior a ela/
  );
});

test('a refused key says so rather than "no phone"', async () => {
  await assert.rejects(
    () => fetchDevice('http://x', {}, async () => reply(401)),
    /recusou a chave/
  );
});

test('an unreachable server is not an unreachable phone', async () => {
  await assert.rejects(
    () =>
      fetchDevice('http://x', {}, async () => {
        throw new TypeError('Failed to fetch');
      }),
    /Não alcancei o servidor/
  );
});

// -- what it says ------------------------------------------------------------

test('nothing linked is said plainly, with what to do', () => {
  const { tone, text } = summarize({ linked: false, transport: 'none' });
  assert.equal(tone, 'bad');
  assert.match(text, /runner no Termux/);
});

test('an old runner is connected and still cannot tap anything', () => {
  // The state that reads as working and is not.
  const { tone, text } = summarize({ linked: true, name: 'pixel', stale: true });
  assert.equal(tone, 'warn');
  assert.match(text, /runner antigo/);
  assert.match(text, /curl -O/, 'say how to fix it');
});

test('a free shell is flagged, not celebrated', () => {
  const { tone, text } = summarize({ linked: true, name: 'pixel', shell: true });
  assert.equal(tone, 'warn', 'agreeing to a free shell is a bigger thing than --allow-ui');
  assert.match(text, /shell livre/);
});

test('the screen being open is the good case', () => {
  const { tone, text } = summarize({ linked: true, name: 'pixel', ui: true });
  assert.equal(tone, 'good');
  assert.match(text, /controlar a tela/);
});

test('linked without the screen says which flag opens it', () => {
  const { text } = summarize({ linked: true, name: 'pixel', ui: false, shell: false });
  assert.match(text, /--allow-ui/);
});

test('SSH is reported as reachable even with nothing linked', () => {
  // There is no runner in this case, and the phone is still reachable.
  const { tone, text } = summarize({ linked: false, transport: 'ssh', ssh: 'me@10.0.0.5:8022' });
  assert.equal(tone, 'good');
  assert.match(text, /SSH/);
  assert.match(text, /10\.0\.0\.5/);
});

test('running inside Termux is its own answer', () => {
  const { tone, text } = summarize({ linked: false, transport: 'local' });
  assert.equal(tone, 'good');
  assert.match(text, /dentro do próprio aparelho/);
});

test('nonsense does not throw', () => {
  for (const state of [null, undefined, {}, { linked: 'talvez' }]) {
    const { tone, text } = summarize(state);
    assert.ok(tone && text, JSON.stringify(state));
  }
});

// -- the rows ----------------------------------------------------------------

test('the road is always named', () => {
  const rows = details({ linked: true, transport: 'bridge' });
  assert.match(rows[0].value, /ponte/);
});

test('an SSH address is shown, because it decides what is reachable', () => {
  const rows = details({ linked: false, transport: 'ssh', ssh: 'me@10.0.0.5:8022' });
  assert.ok(rows.some((row) => row.value === 'me@10.0.0.5:8022'));
});

test('a linked phone lists what it will and will not do', () => {
  const rows = details({ linked: true, transport: 'bridge', ui: true, shell: false, binaries: ['a', 'b'] });
  const byLabel = Object.fromEntries(rows.map((row) => [row.label, row.value]));
  assert.equal(byLabel['Controlar a tela'], 'sim');
  assert.equal(byLabel['Shell livre'], 'não');
  assert.equal(byLabel['Helpers'], '2 instalados');
});

test('no state is no rows, rather than a row of undefined', () => {
  assert.deepEqual(details(null), []);
});
