/**
 * Speaking while the answer is still arriving.
 *
 * The voice used to wait for the whole reply: stream it into the caption,
 * then, once the model had finished, read all of it out. On a free hosted
 * model that is several seconds of a silent face -- the model's whole
 * generation time -- before the first word. People talking do not do that;
 * they start with the first sentence while they work out the rest.
 *
 * So the stream is cut into sentences as it comes, and each goes to the
 * voice the moment it is complete. The first piece is allowed to be short --
 * a clause, up to a comma -- because the only number anyone notices is how
 * long until he starts.
 *
 * Everything here is text and promises; the voice itself is injected.
 */

/** Longest piece to wait for before cutting at a comma anyway. */
const LONG = 160;
/** The first piece may be cut at a comma once it is this long. */
const FIRST_MIN = 24;

/**
 * What a sentence should sound like, not look like.
 *
 * Markdown read aloud is "asterisco asterisco", a code block is a minute of
 * punctuation, and a URL is spelled out letter by letter. None of that is
 * the answer; the caption still has all of it.
 */
export function spoken(text) {
  return String(text ?? '')
    .replace(/```[\s\S]*?```/g, ' (o código está na tela) ')
    .replace(/`([^`]+)`/g, '$1')
    // Markdown links before bare URLs, or the URL inside one is replaced
    // first and the brackets are read out.
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, 'o link na tela')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+[.)]\s+/gm, '')
    .replace(/(\*\*|__|\*|_|~~)(?=\S)([\s\S]*?\S)\1/g, '$2')
    .replace(/[|>#*_~]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Cuts a stream of text into things to say.
 *
 * `push` returns the pieces completed by this chunk; `flush` returns what is
 * left when the stream ends. A sentence is complete when its end mark is
 * followed by a space or a line break -- so "3.5" and "p.ex" stay whole
 * while the model is still typing them.
 */
export class Sentences {
  constructor() {
    this.buffer = '';
    this.inCode = false;
    this.count = 0;
  }

  push(chunk) {
    this.buffer += chunk;
    const out = [];
    for (;;) {
      const cut = this._cut();
      if (cut < 0) break;
      const piece = this.buffer.slice(0, cut);
      this.buffer = this.buffer.slice(cut);
      const said = spoken(piece);
      if (said) {
        out.push(said);
        this.count += 1;
      }
    }
    return out;
  }

  flush() {
    const said = spoken(this.buffer);
    this.buffer = '';
    if (!said) return [];
    this.count += 1;
    return [said];
  }

  /** Where the next complete piece ends, or -1. */
  _cut() {
    const text = this.buffer;
    // A code block is one piece, however many "sentences" are inside it:
    // cutting in the middle would speak half a program.
    const fence = text.indexOf('```');
    if (fence >= 0) {
      const close = text.indexOf('```', fence + 3);
      if (close < 0) return fence > 0 ? this._sentenceEnd(text.slice(0, fence), true) : -1;
      if (fence > 0) {
        const before = this._sentenceEnd(text.slice(0, fence), true);
        if (before > 0) return before;
      }
      return close + 3;
    }
    return this._sentenceEnd(text, false);
  }

  _sentenceEnd(text, whole) {
    // Line breaks end a thought in a list or a paragraph.
    const line = text.indexOf('\n');
    const mark = text.search(/[.!?…:;](?=\s)/);
    const ends = [line, mark >= 0 ? mark + 1 : -1].filter((i) => i > 0);
    if (ends.length) return Math.min(...ends);
    if (whole && text.trim()) return text.length;
    // No sentence end yet. The first piece may stop at a comma, to start
    // talking sooner; any piece stops at one when it has grown long.
    const limit = this.count === 0 ? FIRST_MIN : LONG;
    if (text.length >= limit) {
      const comma = text.slice(limit === LONG ? 0 : FIRST_MIN).search(/,(?=\s)/);
      if (comma >= 0) return comma + 1 + (limit === LONG ? 0 : FIRST_MIN);
    }
    return -1;
  }
}

/**
 * A queue of things to say, one after another, that can be cut off.
 *
 * @param {object} o
 * @param {(text: string) => Promise<void>} o.speak Says one piece; resolves when done.
 * @param {() => void} [o.onStart] The first piece began.
 * @param {() => void} [o.onEnd] Everything was said, or it was cancelled.
 */
export class Talk {
  constructor({ speak, onStart = () => {}, onEnd = () => {} }) {
    this.speak = speak;
    this.onStart = onStart;
    this.onEnd = onEnd;
    this.sentences = new Sentences();
    this.queue = [];
    this.cancelled = false;
    this.started = false;
    this.finished = false;
    /** Everything handed to the voice, in order. */
    this.spoken = [];
    this._loop = null;
    this._closing = false;
  }

  /** Something to say before the answer: "Hum…" while the model thinks.
   *  Ignored once the answer itself has started. */
  prelude(text) {
    if (this.started || this.cancelled) return;
    this.queue.unshift(text);
    this._run();
  }

  /** More of the answer arrived. */
  push(chunk) {
    if (this.cancelled) return;
    this.queue.push(...this.sentences.push(chunk));
    this._run();
  }

  /** The answer is complete; resolves once all of it has been said. */
  async finish() {
    if (!this.cancelled) this.queue.push(...this.sentences.flush());
    this._closing = true;
    this._run();
    while (this._loop) await this._loop;
    this._end();
  }

  /** Cut off: a person started talking, or the answer failed. */
  cancel() {
    this.cancelled = true;
    this.queue = [];
    this._end();
  }

  _end() {
    if (this.finished) return;
    this.finished = true;
    if (this.started) this.onEnd();
  }

  /** One piece at a time, in order, for as long as there are pieces. */
  _run() {
    if (this._loop || this.cancelled || !this.queue.length) return;
    this._loop = (async () => {
      while (!this.cancelled && this.queue.length) {
        const next = this.queue.shift();
        if (!this.started) {
          this.started = true;
          this.onStart();
        }
        this.spoken.push(next);
        try {
          await this.speak(next);
        } catch {
          /* A failed piece must not stop the rest. */
        }
      }
      this._loop = null;
    })();
  }
}

/**
 * The short things said while listening, and while thinking.
 *
 * Rotated rather than random, so the same one never comes twice in a row
 * and a test can know what comes next.
 */
export const NODS = ['Aham.', 'Hum.', 'Entendi.', 'Sei.', 'Ah, sim.', 'Certo.'];
export const THINKING = ['Hum…', 'Deixa eu ver.', 'Certo…', 'Um instante.', 'Então…'];

export class Rotation {
  constructor(items) {
    this.items = items;
    this.at = 0;
  }

  next() {
    const item = this.items[this.at % this.items.length];
    this.at += 1;
    return item;
  }
}

/** Tell the model it is being spoken to, so it answers like speech. */
export const VOICE_PROMPT =
  'Esta conversa é por voz: sua resposta vai ser falada em voz alta enquanto você escreve. ' +
  'Responda como uma pessoa fala: comece com uma frase curta, depois o resto em frases curtas. ' +
  'Nada de markdown, listas, tabelas ou emojis, a não ser que peçam código ou uma lista.';
