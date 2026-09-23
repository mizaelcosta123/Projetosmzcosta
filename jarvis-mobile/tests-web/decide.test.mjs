/**
 * Deciding under uncertainty, and the three AIXI ingredients it approximates.
 *
 * The sampler tests matter more than they look. A Beta draw whose
 * distribution is subtly wrong produces an agent that is subtly
 * overconfident, and *nothing about the behaviour would look wrong* — it
 * would simply explore too little and settle on the wrong option slightly
 * too often. So the moments are checked against their closed forms rather
 * than the output being eyeballed.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  Belief,
  Decider,
  betaSample,
  bits,
  choose,
  expectimax,
  gammaSample,
  localAdapter,
  memoryAdapter,
  occam,
  priors,
  utility,
} from '../web/decide.js';

/** Seeded, so a failure is the same failure tomorrow. */
function seeded(seed = 7) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return (state >>> 8) / 16777216;
  };
}

const mean = (values) => values.reduce((a, b) => a + b, 0) / values.length;
const variance = (values) => {
  const m = mean(values);
  return mean(values.map((v) => (v - m) ** 2));
};

// -- Occam: the 2^-l(k) term -------------------------------------------------

test('a shorter description gets more prior mass', () => {
  assert.ok(occam(2) > occam(8));
  assert.equal(occam(0), 1);
});

test('a local model is a shorter story than a routed one behind a key', () => {
  const local = bits({ id: 'qwen2.5:1.5b', hops: 1, key: false, cost: 0 });
  const routed = bits({ id: 'anthropic/claude-sonnet-4.5', hops: 2, key: true, cost: 0.9 });
  assert.ok(local < routed, `${local} deveria ser menor que ${routed}`);
});

test('the priors are a distribution over the options given', () => {
  const p = priors([{ hops: 1 }, { hops: 3, key: true }]);
  assert.ok(Math.abs(p[0] + p[1] - 1) < 1e-12);
  assert.ok(p[0] > p[1], 'o mais simples leva mais');
});

test('an explicit bit count overrides the derived one', () => {
  // So a caller who knows the real complexity can say so.
  const p = priors([{ bits: 1 }, { bits: 20 }]);
  assert.ok(p[0] > p[1] * 100);
});

// -- the samplers ------------------------------------------------------------

test('Gamma draws have the mean and variance they should', () => {
  /* Gamma(k, 1) has mean k and variance k. Marsaglia-Tsang is exact, so a
     drift here means the boost branch or the squeeze is wrong. */
  const random = seeded(11);
  for (const shape of [0.5, 1, 2.5, 9]) {
    const draws = Array.from({ length: 6000 }, () => gammaSample(shape, random));
    assert.ok(Math.abs(mean(draws) - shape) < shape * 0.08, `média em k=${shape}: ${mean(draws)}`);
    assert.ok(Math.abs(variance(draws) - shape) < shape * 0.2, `variância em k=${shape}`);
  }
});

test('Beta draws match the closed form for mean and variance', () => {
  // Beta(a,b): mean a/(a+b), variance ab / ((a+b)²(a+b+1)).
  const random = seeded(3);
  for (const [a, b] of [[1, 1], [5, 2], [2, 8], [30, 30]]) {
    const draws = Array.from({ length: 6000 }, () => betaSample(a, b, random));
    const n = a + b;
    assert.ok(Math.abs(mean(draws) - a / n) < 0.02, `média Beta(${a},${b}): ${mean(draws)}`);
    const want = (a * b) / (n * n * (n + 1));
    assert.ok(Math.abs(variance(draws) - want) < want * 0.25, `variância Beta(${a},${b})`);
  }
});

test('every draw is a probability', () => {
  const random = seeded(5);
  for (let i = 0; i < 2000; i += 1) {
    const value = betaSample(0.3, 0.3, random);
    assert.ok(value >= 0 && value <= 1, String(value));
  }
});

// -- beliefs: the continuous Bayesian update --------------------------------

test('knowing nothing is uniform, not optimistic', () => {
  /* Beta(1,1). Starting at "probably fine" makes an agent that never tries
     the alternative, because the incumbent is already believed to be good. */
  assert.equal(new Belief().rate, 0.5);
});

test('evidence moves the belief in the direction of the evidence', () => {
  const belief = new Belief();
  for (let i = 0; i < 30; i += 1) belief.update({ ok: true });
  assert.ok(belief.rate > 0.85, String(belief.rate));
  for (let i = 0; i < 60; i += 1) belief.update({ ok: false });
  assert.ok(belief.rate < 0.3, String(belief.rate));
});

test('more evidence means less doubt', () => {
  const few = new Belief();
  const many = new Belief();
  for (let i = 0; i < 3; i += 1) few.update({ ok: true });
  for (let i = 0; i < 300; i += 1) many.update({ ok: true });
  assert.ok(many.doubt < few.doubt);
});

test('old evidence is discounted, which is what a frozen model cannot do', () => {
  /* An endpoint that was reliable last month and has been failing since must
     be believed to be failing *now*. Without decay the posterior hardens and
     the agent defends a belief against the evidence. */
  const belief = new Belief({ decay: 0.9 });
  for (let i = 0; i < 200; i += 1) belief.update({ ok: true });
  const before = belief.rate;
  for (let i = 0; i < 20; i += 1) belief.update({ ok: false });
  assert.ok(belief.rate < before * 0.6, `${before} -> ${belief.rate}`);
});

test('without decay the same run barely moves', () => {
  // The contrast that shows the decay is doing the work.
  const stubborn = new Belief({ decay: 1 });
  for (let i = 0; i < 200; i += 1) stubborn.update({ ok: true });
  const before = stubborn.rate;
  for (let i = 0; i < 20; i += 1) stubborn.update({ ok: false });
  assert.ok(stubborn.rate > before * 0.85);
});

test('latency is averaged without keeping the history', () => {
  // Welford: stable, and needs no array.
  const belief = new Belief();
  for (const ms of [1000, 2000, 3000]) belief.update({ ok: true, ms });
  assert.ok(Math.abs(belief.seconds - 2) < 1e-9, String(belief.seconds));
});

test('a missing or absurd latency is ignored rather than poisoning the mean', () => {
  const belief = new Belief();
  belief.update({ ok: true, ms: 1000 });
  belief.update({ ok: true });
  belief.update({ ok: true, ms: NaN });
  assert.ok(Math.abs(belief.seconds - 1) < 1e-9, String(belief.seconds));
});

// -- utility -----------------------------------------------------------------

test('slower and dearer are worth less at the same success rate', () => {
  const fast = utility({ seconds: 0.5, cost: 0 }, 0.9);
  const slow = utility({ seconds: 30, cost: 0 }, 0.9);
  const dear = utility({ seconds: 0.5, cost: 2 }, 0.9);
  assert.ok(fast > slow);
  assert.ok(fast > dear);
});

test('a route that works nine times in ten but takes a minute loses to one that does not', () => {
  /* Subtracted rather than multiplied, so this comparison can come out the
     way it should. */
  const reliableSlow = utility({ seconds: 60, cost: 0 }, 0.9);
  const decentFast = utility({ seconds: 1, cost: 0 }, 0.8);
  assert.ok(decentFast > reliableSlow);
});

// -- choosing ----------------------------------------------------------------

test('with nothing to choose between there is no choice', () => {
  assert.equal(choose([]), null);
  assert.equal(choose(undefined), null);
});

test('it finds the better option and stays with it', () => {
  const random = seeded(21);
  const decider = new Decider({ adapter: memoryAdapter(), random });
  const options = [
    { id: 'bom', hops: 1 },
    { id: 'ruim', hops: 1 },
  ];
  for (let i = 0; i < 300; i += 1) {
    const picked = decider.pick(options).option.id;
    decider.learn(picked, { ok: picked === 'bom' ? random() < 0.9 : random() < 0.2 });
  }
  const [best] = decider.ranking();
  assert.equal(best.id, 'bom');
  // And the last stretch is spent on it rather than still sampling evenly.
  const recent = Array.from({ length: 40 }, () => decider.pick(options).option.id);
  assert.ok(recent.filter((id) => id === 'bom').length > 30, recent.join(' '));
});

test('but it tries the unknown one rather than never looking', () => {
  /* Thompson sampling explores because it draws from the posterior instead of
     from its mean. An option nobody has tried has a wide posterior, so it
     sometimes draws high — no epsilon, no schedule. */
  const random = seeded(9);
  const decider = new Decider({ adapter: memoryAdapter(), random });
  const options = [{ id: 'conhecido', hops: 1 }, { id: 'novo', hops: 1 }];
  for (let i = 0; i < 12; i += 1) decider.learn('conhecido', { ok: true });
  const tried = Array.from({ length: 60 }, () => decider.pick(options).option.id);
  assert.ok(tried.includes('novo'), 'nunca experimentou o desconhecido');
});

test('and the greedy agent does not, which is what shows the sampling did it', () => {
  const decider = new Decider({ adapter: memoryAdapter(), random: seeded(9) });
  const options = [{ id: 'conhecido', hops: 1 }, { id: 'novo', hops: 1 }];
  for (let i = 0; i < 12; i += 1) decider.learn('conhecido', { ok: true });
  const tried = Array.from({ length: 30 }, () => decider.pick(options, { explore: 0 }).option.id);
  assert.deepEqual([...new Set(tried)], ['conhecido']);
});

test('simplicity breaks a tie, and only a tie', () => {
  /* The 2^-l(k) term doing the only job it can at this scale. A cube root, so
     a shorter description nudges rather than vetoes — raw 2^-l would let
     description length overrule evidence, which is the failure Occam's razor
     is usually accused of. */
  const decider = new Decider({ adapter: memoryAdapter(), random: seeded(4) });
  const simple = { id: 'local', hops: 1, key: false, cost: 0 };
  const complex = { id: 'nuvem', hops: 3, key: true, cost: 1 };
  assert.equal(decider.pick([simple, complex], { explore: 0 }).option.id, 'local');

  // Now give the complex one a record the simple one cannot match.
  for (let i = 0; i < 80; i += 1) {
    decider.learn('nuvem', { ok: true });
    decider.learn('local', { ok: false });
  }
  assert.equal(decider.pick([simple, complex], { explore: 0 }).option.id, 'nuvem');
});

test('the reason is in words, not just a number', () => {
  const decider = new Decider({ adapter: memoryAdapter(), random: seeded(2) });
  decider.learn('x', { ok: true, ms: 1200 });
  const { why } = decider.pick([{ id: 'x', hops: 1 }], { explore: 0 });
  assert.match(why, /taxa \d+%/);
  assert.match(why, /dúvida/);
  assert.match(why, /simplicidade/);
});

// -- planning ----------------------------------------------------------------

test('it takes the branch with the better expected value', () => {
  const world = {
    actions: ['seguro', 'arriscado'],
    outcomes: (action) => (action === 'seguro'
      ? [{ p: 1, reward: 1 }]
      : [{ p: 0.5, reward: 4 }, { p: 0.5, reward: -1 }]),
  };
  // Seguro vale 1; arriscado vale 0.5*4 + 0.5*(-1) = 1.5.
  assert.equal(expectimax(world, 1).action, 'arriscado');
});

test('and averages over what might happen rather than assuming the best', () => {
  /* The Σ_o inside the max_a. A planner that took the best outcome instead of
     the expectation would call a lottery ticket a good investment. */
  const world = {
    actions: ['aposta'],
    outcomes: () => [{ p: 0.01, reward: 100 }, { p: 0.99, reward: 0 }],
  };
  assert.ok(Math.abs(expectimax(world, 1).value - 1) < 1e-9);
});

test('a reward now beats the same reward later', () => {
  const later = {
    actions: ['esperar'],
    outcomes: () => [{ p: 1, reward: 0, next: { actions: ['x'], outcomes: () => [{ p: 1, reward: 10 }] } }],
  };
  const now = { actions: ['agora'], outcomes: () => [{ p: 1, reward: 10 }] };
  assert.ok(expectimax(now, 2).value > expectimax(later, 2).value);
});

test('looking further finds what one step cannot', () => {
  const world = {
    actions: ['curto', 'longo'],
    outcomes: (action) => (action === 'curto'
      ? [{ p: 1, reward: 2 }]
      : [{ p: 1, reward: 0, next: { actions: ['a'], outcomes: () => [{ p: 1, reward: 10 }] } }]),
  };
  assert.equal(expectimax(world, 1).action, 'curto', 'um passo não enxerga o prêmio');
  assert.equal(expectimax(world, 2).action, 'longo');
});

test('depth zero and no actions are answers, not crashes', () => {
  const world = { actions: ['x'], outcomes: () => [{ p: 1, reward: 5 }] };
  assert.equal(expectimax(world, 0).action, null);
  assert.equal(expectimax({ actions: [] }, 3).action, null);
});

// -- persistence -------------------------------------------------------------

test('what was learned about your endpoints outlives the session', () => {
  const adapter = memoryAdapter();
  const first = new Decider({ adapter }).open();
  for (let i = 0; i < 40; i += 1) first.learn('nuvem', { ok: true, ms: 2000 });

  const second = new Decider({ adapter }).open();
  assert.ok(second.belief('nuvem').rate > 0.8);
  assert.ok(Math.abs(second.belief('nuvem').seconds - 2) < 0.01);
});

test('rubbish in storage does not stop it opening', () => {
  const decider = new Decider({ adapter: memoryAdapter({ bom: { alpha: 4, beta: 1 }, ruim: null }) }).open();
  assert.ok(decider.belief('bom').rate > 0.7);
  assert.equal(decider.beliefs.has('ruim'), false);
});

test('an option nobody has seen gets an open mind, not a refusal', () => {
  const decider = new Decider({ adapter: memoryAdapter() }).open();
  assert.equal(decider.belief('nunca visto').rate, 0.5);
});

test('the ranking is ordered and says how much it is based on', () => {
  const decider = new Decider({ adapter: memoryAdapter() }).open();
  for (let i = 0; i < 10; i += 1) decider.learn('bom', { ok: true });
  for (let i = 0; i < 10; i += 1) decider.learn('ruim', { ok: false });
  const ranked = decider.ranking();
  assert.equal(ranked[0].id, 'bom');
  assert.ok(ranked[0].tried >= 9, `${ranked[0].tried}`);
});


test('the default place to keep beliefs is the browser, not a test double', () => {
  /* It was `memoryAdapter` — the double — so in the real app nothing was
     written and every belief died with the tab. Every test above passes an
     adapter explicitly, which is exactly how a wrong default survives a full
     suite. The browser found it in one call. */
  const store = {};
  const before = globalThis.localStorage;
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (k) => store[k] ?? null,
      setItem: (k, v) => { store[k] = v; },
    },
    configurable: true,
  });

  const decider = new Decider().open();
  decider.learn('rota', { ok: true, ms: 100 });
  assert.ok(store['jarvis.beliefs.v1'], 'não gravou nada');
  assert.ok(JSON.parse(store['jarvis.beliefs.v1']).rota.alpha > 1);

  Object.defineProperty(globalThis, 'localStorage', { value: before, configurable: true });
});

test('and it still works where there is no storage at all', () => {
  // Private mode, or a browser that throws on access. Losing the write must
  // never throw in the middle of a decision.
  const before = globalThis.localStorage;
  Object.defineProperty(globalThis, 'localStorage', { value: undefined, configurable: true });
  assert.doesNotThrow(() => {
    const decider = new Decider().open();
    decider.learn('rota', { ok: true });
    decider.pick([{ id: 'rota' }]);
  });
  Object.defineProperty(globalThis, 'localStorage', { value: before, configurable: true });
});
