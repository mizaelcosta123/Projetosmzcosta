/**
 * What he remembers, and how he gets better at finding it.
 *
 * Two things this is, and one thing it is not.
 *
 * **It is** a store of episodes -- what you asked, what he did, what you
 * called things -- and a retrieval mechanism that pulls the relevant ones
 * back when a new message arrives. Used that way it genuinely improves with
 * time: the more he has seen you do, the better the context he can put in
 * front of the model.
 *
 * **It is** built on real attention. `attend()` below is scaled dot-product
 * attention -- softmax(QKᵀ/√d)V -- the same primitive a transformer block
 * runs, applied here to a store instead of to a sequence. That is not a
 * metaphor: the function computes it, and the tests check the properties
 * that make it that rather than a similarity sort (a distribution that sums
 * to one, temperature through √d, ordering preserved under shift).
 *
 * **It is not** a language model, and running it does not make one. There
 * are no learned weights here; the vectors are hashed features, not trained
 * embeddings, and nothing back-propagates. It makes retrieval good, which is
 * most of what "remembers me" feels like in practice, and it is worth being
 * exact about the difference.
 *
 * The store is an adapter on purpose. Today it is localStorage; an Obsidian
 * vault is the same shape -- a list of notes with text and a path -- so
 * plugging one in later means writing `load` and `save`, not rewriting this.
 */

/** How many dimensions the hashed feature space has. */
export const DIMS = 256;

/** Everything below this weight in an attention pass is not worth carrying. */
const FLOOR = 0.02;

/** Words that carry no signal and would dominate a bag of words. */
const STOP = new Set([
  'a', 'o', 'as', 'os', 'um', 'uma', 'de', 'do', 'da', 'dos', 'das', 'em',
  'no', 'na', 'nos', 'nas', 'que', 'e', 'é', 'ou', 'por', 'para', 'com',
  'se', 'ao', 'à', 'the', 'of', 'and', 'to', 'in', 'is', 'it', 'for',
]);

/** Fold a string to lowercase without accents, so "câmera" meets "camera". */
export function fold(text) {
  return String(text ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/** The words worth indexing in a phrase. */
export function tokens(text) {
  return fold(text)
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 1 && !STOP.has(word));
}

/** A small, stable string hash. Deterministic across loads, by construction. */
function hash(word) {
  let h = 2166136261;
  for (let i = 0; i < word.length; i += 1) {
    h ^= word.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % DIMS;
}

/**
 * Turn a phrase into a unit vector.
 *
 * Hashed features, not a trained embedding: two phrases are close when they
 * share words, and that is all. It is deliberately the dumb version, because
 * the alternative is shipping a model file to a phone, and the dumb version
 * is enough to tell "abre a câmera" from "cria um cubo".
 *
 * Trigrams ride along with the words so a typo still lands near its target.
 */
export function embed(text) {
  const vector = new Float32Array(DIMS);
  const words = tokens(text);
  for (const word of words) {
    vector[hash(word)] += 1;
    for (let i = 0; i + 3 <= word.length; i += 1) {
      // 0.8, measured rather than guessed. Going from 0.35 to 0.8 roughly
      // triples how close a misspelling lands to its target (cubo/cuubo:
      // 0.09 -> 0.24) and costs nothing anywhere else -- two unrelated words
      // stay at exactly 0.00 and two phrasings of the same request stay at
      // 0.33. Past about 0.9 the gains flatten.
      vector[hash(word.slice(i, i + 3))] += 0.8;
    }
  }
  // L2, so a long sentence does not outrank a short one just by being long.
  let sum = 0;
  for (const value of vector) sum += value * value;
  const length = Math.sqrt(sum);
  if (length > 0) for (let i = 0; i < DIMS; i += 1) vector[i] /= length;
  return vector;
}

/** Dot product of two same-length vectors. */
export function dot(a, b) {
  let total = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) total += a[i] * b[i];
  return total;
}

/**
 * Scaled dot-product attention: softmax(qKᵀ / scale) over the keys.
 *
 * The √d in the textbook formula exists for a specific reason, and it only
 * holds under a specific assumption. Take q and k with independent
 * components of roughly unit variance: their dot product has variance d, so
 * it grows like √d, and without dividing it back out the softmax saturates
 * at any real dimension -- one key takes essentially all the weight and
 * every other memory becomes invisible.
 *
 * That assumption is **false for the vectors in this file**. `embed` returns
 * unit-norm vectors, so qKᵀ is already a cosine in [-1, 1] and does not grow
 * with d at all. Dividing by √256 = 16 then does the opposite of stabilising:
 * every logit lands within 0.06 of every other and the distribution comes out
 * flat. Measured, not reasoned about -- the first version of this scored
 * three unrelated memories at 0.340, 0.332 and 0.329, which is a uniform
 * distribution wearing a softmax.
 *
 * So the scale is explicit. `scaled: true` is the textbook √d, correct for
 * raw features. `scaled: false` is for unit-norm keys, where temperature is
 * the only knob that means anything -- the variant usually called cosine
 * attention.
 *
 * The max is subtracted before exponentiating for the usual reason: it
 * changes nothing in the result and keeps exp() away from overflow.
 *
 * @param {Float32Array} query
 * @param {Float32Array[]} keys
 * @param {{temperature?: number, scaled?: boolean}} [options]
 * @returns {number[]} Weights, summing to 1. Empty for no keys.
 */
export function attend(query, keys, { temperature = 1, scaled = true } = {}) {
  if (!keys?.length) return [];
  const scale = (scaled ? Math.sqrt(query.length) : 1) * (temperature || 1);
  const scores = keys.map((key) => dot(query, key) / scale);
  const top = Math.max(...scores);
  const weights = scores.map((score) => Math.exp(score - top));
  const total = weights.reduce((a, b) => a + b, 0);
  return weights.map((weight) => weight / total);
}

/** One thing remembered. */
export function episode({ text, kind = 'nota', at = Date.now(), uses = 0, source = '' } = {}) {
  return { id: `m${at.toString(36)}${Math.random().toString(36).slice(2, 6)}`,
           text: String(text ?? ''), kind, at, uses, source };
}

/**
 * The store.
 *
 * `adapter` is `{load(), save(rows)}`. Anything shaped like a list of notes
 * fits, which is the point: a vault is that shape.
 */
export class Memory {
  constructor({ adapter, limit = 500, now = () => Date.now() } = {}) {
    this.adapter = adapter ?? localAdapter();
    this.limit = limit;
    this.now = now;
    /** @type {Array<ReturnType<typeof episode>>} */
    this.rows = [];
    /** Vectors, parallel to rows. Kept out of storage: they are derivable,
     *  and writing 256 floats per row to localStorage is how you fill it. */
    this.keys = [];
  }

  /** Read what was stored, and rebuild the vectors. */
  open() {
    const stored = this.adapter.load() ?? [];
    this.rows = stored.filter((row) => row && typeof row.text === 'string');
    this.keys = this.rows.map((row) => embed(row.text));
    return this;
  }

  /** Remember something. Returns the episode. */
  learn(text, { kind = 'nota', source = '' } = {}) {
    const clean = String(text ?? '').trim();
    if (!clean) return null;
    // Saying the same thing twice is a reinforcement, not a second memory.
    const existing = this.rows.find((row) => fold(row.text) === fold(clean) && row.kind === kind);
    if (existing) {
      existing.uses += 1;
      existing.at = this.now();
      this.adapter.save(this.rows);
      return existing;
    }
    const row = episode({ text: clean, kind, at: this.now(), source });
    this.rows.push(row);
    this.keys.push(embed(clean));
    this._forgetOldest();
    this.adapter.save(this.rows);
    return row;
  }

  /**
   * What is worth putting in front of the model for this message.
   *
   * Attention gives the weights; `uses` tilts them, so something confirmed
   * useful ten times outranks a one-off that happens to share a word. The
   * tilt is a multiplier on the weight and not on the score, deliberately:
   * inside the softmax it would fight the temperature and make the whole
   * distribution a function of how often you have used the app.
   *
   * @param {string} text The new message.
   * @param {{count?: number, temperature?: number}} [options]
   */
  recall(text, { count = 5, temperature = 0.08 } = {}) {
    if (this.rows.length === 0) return [];
    // `scaled: false`, because `embed` hands back unit vectors: see `attend`.
    // 0.08 puts a cosine gap of 0.3 about four logits apart, which separates
    // "about this" from "shares a word with this" without going one-hot.
    const weights = attend(embed(text), this.keys, { temperature, scaled: false });
    const scored = this.rows.map((row, i) => ({
      row,
      weight: weights[i] * (1 + Math.log1p(row.uses) * 0.35),
    }));
    return scored
      .filter((entry) => entry.weight >= FLOOR / this.rows.length)
      .sort((a, b) => b.weight - a.weight)
      .slice(0, count);
  }

  /** Mark a memory as having been worth it. */
  reinforce(id) {
    const row = this.rows.find((entry) => entry.id === id);
    if (!row) return null;
    row.uses += 1;
    this.adapter.save(this.rows);
    return row;
  }

  /** Drop one. Asked for by name, because a person must be able to. */
  forget(id) {
    const at = this.rows.findIndex((row) => row.id === id);
    if (at < 0) return false;
    this.rows.splice(at, 1);
    this.keys.splice(at, 1);
    this.adapter.save(this.rows);
    return true;
  }

  /** Everything, newest first. */
  all() {
    return [...this.rows].sort((a, b) => b.at - a.at);
  }

  /**
   * Drop the least useful when over the limit.
   *
   * Oldest *and* least used, not just oldest: something you taught him once
   * and lean on weekly must not be evicted by a week of chatter.
   */
  _forgetOldest() {
    while (this.rows.length > this.limit) {
      let worst = 0;
      let worstScore = Infinity;
      for (let i = 0; i < this.rows.length; i += 1) {
        const score = this.rows[i].at + this.rows[i].uses * 86400000;
        if (score < worstScore) {
          worstScore = score;
          worst = i;
        }
      }
      this.rows.splice(worst, 1);
      this.keys.splice(worst, 1);
    }
  }
}

/** The default place to keep it: this browser, this origin. */
export function localAdapter(key = 'jarvis.memory.v1') {
  return {
    load() {
      try {
        return JSON.parse(globalThis.localStorage?.getItem(key) ?? '[]');
      } catch {
        return [];
      }
    },
    save(rows) {
      try {
        globalThis.localStorage?.setItem(key, JSON.stringify(rows));
      } catch {
        /* Full, or private mode. Losing the write is better than throwing
           in the middle of a conversation. */
      }
    },
  };
}

/** A store that keeps nothing, for tests and for a private session. */
export function nowhereAdapter(seed = []) {
  let rows = [...seed];
  return { load: () => rows, save: (next) => { rows = next; } };
}
