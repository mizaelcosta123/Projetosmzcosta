/**
 * Choosing what to do next, under uncertainty, and getting better at it.
 *
 * ## What this is, against AIXI
 *
 * Hutter's AIXI is the reference definition of an ideal general agent:
 *
 *     a_t := argmax_{a_t} Σ_{o_t r_t} … max_{a_m} Σ_{o_m r_m}
 *              [ Σ_{k : U(k,a_1..a_m) = o_1 r_1 .. o_m r_m} 2^-l(k) ] Σ_{i=t}^m r_i
 *
 * Three ingredients, and the file implements a computable approximation of
 * each. It is worth being exact about the word *approximation*, because the
 * gap is not an engineering shortfall that a faster phone would close:
 *
 * **AIXI is incomputable.** Not expensive -- incomputable, and Hutter proved
 * it when he proposed it. The inner sum runs over every program k whose
 * output reproduces the interaction history, and deciding which programs do
 * that is the halting problem. No amount of code closes that gap. What
 * follows is therefore not "AGI"; it is the three ideas, each replaced by
 * something a phone can actually run, applied to a decision this app really
 * faces.
 *
 * | AIXI term | here | what is given up |
 * |---|---|---|
 * | `Σ_k 2^-l(k)` over all programs | `occam()` over a fixed, named hypothesis set | universality: it can only weigh options someone wrote down |
 * | `argmax Σ r_i` full expectimax to horizon m | Thompson sampling, plus bounded-depth expectimax | optimality: it explores well, it does not plan perfectly |
 * | Bayesian update over all environments | Beta-Bernoulli and Normal running stats per option | it models *this* decision, not the world |
 *
 * What is genuinely kept is the part that matters in practice: the agent
 * holds beliefs, updates them from every outcome, prefers the simpler
 * explanation when the evidence is level, and balances trying something new
 * against using what already works. A fixed Transformer does none of those --
 * its weights are frozen after training, which is the real observation in the
 * material this was written from.
 *
 * ## The decision it is pointed at
 *
 * Which route and model to send a request through. That is a sequential
 * decision under uncertainty with real stakes -- a local Ollama is free and
 * sometimes wrong, a large cloud model is accurate and costs money and
 * seconds -- and it is the shape AIXI describes at a size where
 * approximations behave.
 */

/**
 * Description length, in bits, of an option.
 *
 * This is the `l(k)` in `2^-l(k)`. In AIXI it is the length of a program that
 * explains the environment; here it is the length of the option's own
 * description, which is the same idea one rung down: prefer the hypothesis
 * that takes less to state.
 *
 * The parts are chosen so that "simpler" means what a person would mean.
 * A local model with no key and no network is a shorter story than a routed
 * cloud model behind an aggregator, and when two options have performed
 * identically the shorter story should win.
 */
export function bits(option = {}) {
  let length = 0;
  // Every hop is a thing that can be wrong: another host, another queue.
  length += (option.hops ?? 1) * 2;
  // A key is state that has to be right, and can expire.
  if (option.key) length += 3;
  // Money is not complexity, but an option that can silently cost is a longer
  // story than one that cannot.
  if ((option.cost ?? 0) > 0) length += 2;
  // A name carries information; a longer id is usually a more specific,
  // more particular thing. Scaled down hard -- this is a tiebreaker.
  length += Math.min(6, String(option.id ?? '').length / 8);
  return length;
}

/** The Occam prior: `2^-l(k)`. Shorter descriptions get more prior mass. */
export function occam(length) {
  return 2 ** -Math.max(0, length);
}

/** Normalised Occam weights over a set of options. */
export function priors(options) {
  const raw = options.map((option) => occam(option.bits ?? bits(option)));
  const total = raw.reduce((a, b) => a + b, 0);
  return total > 0 ? raw.map((value) => value / total) : options.map(() => 1 / options.length);
}

// -- sampling ----------------------------------------------------------------

/** Box-Muller, one normal at a time. */
function gaussian(random) {
  let u = 0;
  while (u === 0) u = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
}

/**
 * A draw from Gamma(shape, 1), by Marsaglia and Tsang.
 *
 * Needed because a Beta draw is the ratio of two Gammas, and a Beta draw is
 * what Thompson sampling needs. Written out rather than approximated: a
 * sampler whose distribution is subtly wrong makes an agent that is subtly
 * overconfident, and nothing about the behaviour would look wrong.
 */
export function gammaSample(shape, random = Math.random) {
  if (shape < 1) {
    // Boost: Gamma(a) = Gamma(a+1) * U^(1/a), for a < 1.
    return gammaSample(shape + 1, random) * random() ** (1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x;
    let v;
    do {
      x = gaussian(random);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = random();
    if (u < 1 - 0.0331 * x ** 4) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

/** A draw from Beta(a, b). */
export function betaSample(a, b, random = Math.random) {
  const x = gammaSample(a, random);
  const y = gammaSample(b, random);
  return x + y === 0 ? 0.5 : x / (x + y);
}

// -- beliefs -----------------------------------------------------------------

/**
 * What is believed about one option, and it changes with every outcome.
 *
 * Success is Beta-Bernoulli: the conjugate pair, so the update is exact and
 * is two additions rather than an optimisation. Latency is a running mean and
 * variance, which is the Normal case with the variance estimated rather than
 * known -- enough to tell "usually two seconds" from "usually two seconds,
 * sometimes twenty".
 *
 * `decay` is what a fixed Transformer cannot do at all. Old evidence is
 * discounted on every update, so an endpoint that was reliable last month and
 * has been failing since is believed to be failing now. Without it the
 * posterior hardens and the agent defends a belief against the evidence.
 */
export class Belief {
  constructor({ alpha = 1, beta = 1, decay = 0.995, latency = 0, spread = 0, seen = 0 } = {}) {
    // Beta(1,1) is uniform: knowing nothing, rather than assuming the best.
    this.alpha = alpha;
    this.beta = beta;
    this.decay = decay;
    this.latency = latency;
    this.spread = spread;
    this.seen = seen;
  }

  /** The posterior mean success rate. */
  get rate() {
    return this.alpha / (this.alpha + this.beta);
  }

  /** How sure it is, as the posterior's standard deviation. */
  get doubt() {
    const n = this.alpha + this.beta;
    return Math.sqrt((this.alpha * this.beta) / (n * n * (n + 1)));
  }

  /**
   * Fold in one outcome.
   *
   * @param {{ok: boolean, ms?: number}} outcome
   */
  update({ ok, ms }) {
    // Decay first, then add: the new observation arrives at full weight and
    // everything before it is worth slightly less than it was.
    this.alpha = 1 + (this.alpha - 1) * this.decay;
    this.beta = 1 + (this.beta - 1) * this.decay;
    if (ok) this.alpha += 1;
    else this.beta += 1;

    if (typeof ms === 'number' && Number.isFinite(ms)) {
      this.seen += 1;
      const was = this.latency;
      // Welford, so the variance is stable and needs no stored history.
      this.latency += (ms - was) / this.seen;
      this.spread += (ms - was) * (ms - this.latency);
    }
    return this;
  }

  /** A draw from the posterior. This is what makes it Thompson sampling. */
  draw(random = Math.random) {
    return betaSample(this.alpha, this.beta, random);
  }

  /** Typical latency in seconds, and how variable it is. */
  get seconds() {
    return this.latency / 1000;
  }

  toJSON() {
    const { alpha, beta, decay, latency, spread, seen } = this;
    return { alpha, beta, decay, latency, spread, seen };
  }
}

// -- utility -----------------------------------------------------------------

/**
 * One number out of several things that matter.
 *
 * AIXI writes `r_t` and says nothing about where it comes from, which hides a
 * real modelling decision: an agent that values only success will always pick
 * the slowest, most expensive model, and one that values only cost will
 * always pick the worst. The weights are here, in the open, so they can be
 * argued with.
 */
export const WEIGHTS = { success: 1, seconds: 0.06, cost: 0.4 };

/**
 * Expected reward for an option, given a sampled success rate.
 *
 * Latency and cost are subtracted rather than multiplied: a route that works
 * nine times in ten but takes a minute is worse than one that works eight
 * times in ten and answers at once, and multiplying would not say that.
 */
export function utility(option, rate, weights = WEIGHTS) {
  return (
    rate * weights.success
    - (option.seconds ?? 0) * weights.seconds
    - (option.cost ?? 0) * weights.cost
  );
}

// -- choosing ----------------------------------------------------------------

/**
 * Pick one, by Thompson sampling against the Occam prior.
 *
 * Thompson sampling is `argmax` over a *draw* from the posterior rather than
 * over its mean, and that one change is what makes the agent explore. An
 * option it is unsure about has a wide posterior, so it sometimes draws high
 * and gets tried; one it is sure is bad draws low every time and is left
 * alone. It needs no exploration schedule and no epsilon to tune, and it is
 * the standard practical stand-in for the Bayesian expectimax AIXI writes.
 *
 * The prior enters as a multiplier on the drawn rate. Two options with
 * identical histories are separated by which is the simpler story, which is
 * the `2^-l(k)` term doing the only job it can do at this scale.
 *
 * @param {Array<{id: string, belief: Belief}>} options
 * @param {{random?: () => number, weights?: object, explore?: number}} [how]
 * @returns {{option, score: number, why: string}|null}
 */
export function choose(options, { random = Math.random, weights = WEIGHTS, explore = 1 } = {}) {
  if (!options?.length) return null;
  const prior = priors(options);
  let best = null;
  for (let i = 0; i < options.length; i += 1) {
    const option = options[i];
    const belief = option.belief ?? new Belief();
    // `explore: 0` collapses to the posterior mean, which is the greedy agent
    // -- useful for a decision that must be reproducible, and for testing
    // that the sampling is what creates the exploration.
    const drawn = explore > 0
      ? belief.rate + (belief.draw(random) - belief.rate) * explore
      : belief.rate;
    // The prior is gentle: a cube root, so a simpler option gets a nudge and
    // not a veto. Raw 2^-l would let description length overrule evidence,
    // which is exactly the failure Occam's razor is accused of.
    const score = utility({ ...option, seconds: belief.seconds }, drawn, weights)
      * prior[i] ** (1 / 3);
    if (!best || score > best.score) {
      best = {
        option,
        score,
        why: `taxa ${(belief.rate * 100).toFixed(0)}%, dúvida ±${(belief.doubt * 100).toFixed(0)}%, `
          + `${belief.seconds ? `${belief.seconds.toFixed(1)}s, ` : ''}`
          + `simplicidade ${(prior[i] * 100).toFixed(0)}%`,
      };
    }
  }
  return best;
}

/**
 * Look further than one step.
 *
 * The `max_a Σ_o` alternation in AIXI, at a depth a phone can afford. Each
 * level maximises over actions and averages over what might come back,
 * weighted by how likely the belief says it is -- which is expectimax, and
 * is the part that distinguishes planning from reacting.
 *
 * Bounded at a shallow depth on purpose. The tree is |actions|^depth, and
 * beyond about three the cost is real while the gain is not: the belief
 * about what happens four steps out is too weak to plan against.
 *
 * @param {{actions: Array, outcomes: (action) => Array<{p: number, reward: number, next?: object}>}} world
 * @param {number} depth
 */
export function expectimax(world, depth = 2, discount = 0.9) {
  if (depth <= 0 || !world?.actions?.length) return { value: 0, action: null };
  let best = { value: -Infinity, action: null };
  for (const action of world.actions) {
    let value = 0;
    for (const { p, reward, next } of world.outcomes(action)) {
      // The recursion is the Σ_o inside the max_a: average the futures,
      // weighted by belief, and discount so a reward now beats one later.
      const rest = next ? expectimax(next, depth - 1, discount).value : 0;
      value += p * (reward + discount * rest);
    }
    if (value > best.value) best = { value, action };
  }
  return best;
}

/**
 * The agent: holds the beliefs, chooses, and learns from what happened.
 *
 * Persisted behind an adapter for the same reason the memory store is: what
 * it has learned about your endpoints is worth more than any single session,
 * and it is the thing that makes the next month better than this one.
 */
export class Decider {
  constructor({ adapter, weights = WEIGHTS, random = Math.random } = {}) {
    // `localAdapter`, not `memoryAdapter`. The default was the in-memory one
    // -- the test double -- so in the real app nothing was ever written and
    // every belief died with the tab. No unit test caught it: they all pass
    // an adapter explicitly, which is precisely how a wrong default survives.
    this.adapter = adapter ?? localAdapter();
    this.weights = weights;
    this.random = random;
    /** @type {Map<string, Belief>} */
    this.beliefs = new Map();
  }

  open() {
    const stored = this.adapter.load() ?? {};
    for (const [id, state] of Object.entries(stored)) {
      if (state && typeof state === 'object') this.beliefs.set(id, new Belief(state));
    }
    return this;
  }

  /** What is believed about one option, creating an open mind if new. */
  belief(id) {
    if (!this.beliefs.has(id)) this.beliefs.set(id, new Belief());
    return this.beliefs.get(id);
  }

  /**
   * Pick one of these.
   *
   * @param {Array<{id: string, hops?: number, key?: boolean, cost?: number}>} options
   */
  pick(options, how = {}) {
    const ready = (options ?? []).map((option) => ({
      ...option,
      belief: this.belief(option.id),
    }));
    return choose(ready, { random: this.random, weights: this.weights, ...how });
  }

  /** What happened. This is the whole of the learning. */
  learn(id, outcome) {
    this.belief(id).update(outcome);
    this.save();
    return this.beliefs.get(id);
  }

  save() {
    const out = {};
    for (const [id, belief] of this.beliefs) out[id] = belief.toJSON();
    this.adapter.save(out);
  }

  /** Everything believed, best first. For showing a person why. */
  ranking() {
    return [...this.beliefs.entries()]
      .map(([id, belief]) => ({
        id,
        rate: belief.rate,
        doubt: belief.doubt,
        seconds: belief.seconds,
        tried: Math.round(belief.alpha + belief.beta - 2),
      }))
      .sort((a, b) => b.rate - a.rate);
  }
}

/** Kept in this browser. */
export function localAdapter(key = 'jarvis.beliefs.v1') {
  return {
    load() {
      try {
        return JSON.parse(globalThis.localStorage?.getItem(key) ?? '{}');
      } catch {
        return {};
      }
    },
    save(state) {
      try {
        globalThis.localStorage?.setItem(key, JSON.stringify(state));
      } catch {
        /* Full or private. Losing a write must not throw mid-decision. */
      }
    },
  };
}

/** Kept nowhere, for tests. */
export function memoryAdapter(seed = {}) {
  let state = { ...seed };
  return { load: () => state, save: (next) => { state = next; } };
}
