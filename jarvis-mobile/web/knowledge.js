/**
 * The knowledge vault: what he can look up, as opposed to what he remembers.
 *
 * Worth being exact about, because "a pre-trained database that makes him a
 * superintelligence" is not a thing a file can be. The intelligence is the
 * model's, and nothing in a browser changes it. What this changes is what the
 * model has *in front of it*: for every message, the few passages from your
 * notes, documents and the built-in manual that are about that message, with
 * where they came from. A model answering from the right page beats a bigger
 * one answering from memory -- that is the whole idea, and it is called
 * retrieval.
 *
 * The retrieval is the one `memory.js` already uses (hashed features, cosine),
 * applied to passages. It is the dumb version on purpose: no model file to
 * download, works offline, and good enough to tell a recipe from a contract.
 *
 * Separate from the memory, and in IndexedDB rather than localStorage: memory
 * is a few hundred short episodes, this is meant to grow without a ceiling,
 * and localStorage stops at about five megabytes.
 */

import { dot, embed, fold } from './memory.js';

/** About a paragraph: long enough to carry a fact, short enough to be about one thing. */
export const CHUNK = 600;
/** Carried into the next passage, so a sentence cut at the edge is still whole somewhere. */
export const OVERLAP = 120;
/** Below this cosine a passage only shares a word or two with the question. */
export const FLOOR = 0.2;
/** How many passages one message gets. */
export const TOP = 4;
/** And how much text, at most: a context window full of notes crowds out the question. */
export const BUDGET = 2400;

/**
 * Words that say how something is asked, not what about: "como faço",
 * "me fala", "qual é". Left in, "como faço um bolo" lands nearer "como mexo no
 * holograma" than a recipe, because the two share their two commonest words.
 * Taken out of both sides before comparing.
 */
const GENERIC = new Set(`como faco faz fala falar me mim meu minha qual quais quanto quanta quantos
quantas onde quando quem porque pode poderia voce vc tem ter esta estou estao isso isto esse essa este
aqui ai agora hoje sobre tudo bem quero queria preciso gostaria ajuda ajudar favor jarvis pra pro
algum alguma uma uns umas vai vou ser sao foi era muito mais menos dar diz dizer que de do da
o os as um em no na para por com obrigado obrigada valeu oi ola bom boa dia tarde noite`.split(/\s+/));

/** The words of a sentence that carry its subject. */
export function focus(text) {
  const words = fold(text).split(/[^a-z0-9]+/).filter(Boolean);
  const kept = words.filter((word) => !GENERIC.has(word));
  // A sentence made only of these ("bom dia, tudo bem?") is about nothing a
  // catalogue holds, and comes back empty so nothing is looked up for it.
  return kept.join(' ');
}

/** A stable short hash, for spotting a passage already stored. */
export function digest(text) {
  let h = 2166136261;
  const folded = fold(text).replace(/\s+/g, ' ').trim();
  for (let i = 0; i < folded.length; i += 1) {
    h ^= folded.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

/**
 * Cut a document into passages.
 *
 * Paragraphs first, because that is where the author already cut it; a
 * paragraph longer than a passage is cut at a sentence, and a sentence longer
 * than that at a space. Each passage after the first starts with the tail of
 * the one before.
 */
export function chunk(text, { size = CHUNK, overlap = OVERLAP } = {}) {
  const clean = String(text ?? '').replace(/\r\n?/g, '\n').trim();
  if (!clean) return [];
  const pieces = [];
  for (const paragraph of clean.split(/\n\s*\n/)) {
    const flat = paragraph.replace(/\s+/g, ' ').trim();
    if (!flat) continue;
    if (flat.length <= size) {
      pieces.push(flat);
      continue;
    }
    for (const sentence of flat.split(/(?<=[.!?…])\s+/)) {
      if (sentence.length <= size) pieces.push(sentence);
      else for (let i = 0; i < sentence.length; i += size) pieces.push(sentence.slice(i, i + size));
    }
  }
  const out = [];
  let current = '';
  for (const piece of pieces) {
    if (current && current.length + piece.length + 1 > size) {
      out.push(current);
      const tail = current.slice(-overlap);
      const cut = tail.indexOf(' ');
      current = cut >= 0 ? `${tail.slice(cut + 1)} ${piece}` : piece;
    } else {
      current = current ? `${current} ${piece}` : piece;
    }
  }
  if (current) out.push(current);
  return out;
}

/** Strip what a Markdown note carries that is not its text: front matter, link syntax. */
function fromNote(text) {
  return String(text ?? '')
    .replace(/^---\n[\s\S]*?\n---\n/, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[\[([^\]|]+)\|?([^\]]*)\]\]/g, (_, a, b) => b || a)
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
}

/** One CSV line into cells: quotes respected, and the separator guessed from the header. */
function cells(line, separator) {
  const out = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { cell += '"'; i += 1; } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === separator) { out.push(cell.trim()); cell = ''; } else cell += c;
  }
  out.push(cell.trim());
  return out;
}

/** Rows of a CSV as "coluna: valor" lines -- the form a passage can be found by. */
function fromCsv(text) {
  const lines = String(text ?? '').split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return lines.join('\n');
  const separator = [';', '\t', ','].sort((x, y) => lines[0].split(y).length - lines[0].split(x).length)[0];
  const head = cells(lines[0], separator);
  return lines.slice(1)
    .map((line) => cells(line, separator)
      .map((cell, i) => (cell ? `${head[i] || `coluna ${i + 1}`}: ${cell}` : ''))
      .filter(Boolean).join('; '))
    .join('\n\n');
}

/**
 * JSON as documents. A list of `{titulo, texto}` (or title/text/content) is a
 * list of documents; anything else is flattened to its strings.
 */
function fromJson(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return [{ title: '', text }];
  }
  const rows = Array.isArray(data) ? data : (data?.documentos ?? data?.documents ?? data?.itens ?? [data]);
  return rows.map((row) => {
    if (typeof row === 'string') return { title: '', text: row };
    const title = String(row?.titulo ?? row?.title ?? row?.nome ?? row?.name ?? '');
    const body = row?.texto ?? row?.text ?? row?.conteudo ?? row?.content;
    if (typeof body === 'string') return { title, text: body };
    const strings = [];
    const walk = (value, key = '') => {
      if (typeof value === 'string' || typeof value === 'number') strings.push(key ? `${key}: ${value}` : String(value));
      else if (Array.isArray(value)) value.forEach((v) => walk(v, key));
      else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) walk(v, k);
    };
    walk(row);
    return { title, text: strings.join('\n') };
  }).filter((doc) => doc.text.trim());
}

/**
 * A file, as the documents in it. Unknown extensions are read as text.
 * @returns {Array<{title: string, text: string}>}
 */
export function readFile(name, content) {
  const lower = String(name ?? '').toLowerCase();
  const base = String(name ?? '').split('/').pop().replace(/\.[^.]+$/, '');
  if (lower.endsWith('.json')) return fromJson(content).map((doc) => ({ ...doc, title: doc.title || base }));
  if (lower.endsWith('.csv') || lower.endsWith('.tsv')) return [{ title: base, text: fromCsv(content) }];
  if (/\.(md|markdown)$/.test(lower)) return [{ title: base, text: fromNote(content) }];
  return [{ title: base, text: String(content ?? '') }];
}

// -- storage --------------------------------------------------------------------

const DB = 'jarvis';
const STORES = ['conhecimento', 'habilidades'];

/**
 * A store in this browser's IndexedDB, keyed by `id`.
 *
 * Returns null where there is no IndexedDB (a test, an old browser, some
 * private modes) -- the caller then keeps things in memory for the session,
 * which is a vault that forgets, not an app that breaks.
 */
export function indexedAdapter(store, { indexedDB = globalThis.indexedDB } = {}) {
  if (!indexedDB) return null;
  let opening = null;
  const open = () => {
    opening ??= new Promise((resolve, reject) => {
      const request = indexedDB.open(DB, 1);
      request.onupgradeneeded = () => {
        for (const name of STORES) {
          if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name, { keyPath: 'id' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return opening;
  };
  const run = async (mode, work) => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const result = work(tx.objectStore(store));
      tx.oncomplete = () => resolve(result?.result ?? result);
      tx.onerror = () => reject(tx.error);
    });
  };
  return {
    load: () => run('readonly', (s) => s.getAll()),
    put: (rows) => run('readwrite', (s) => { for (const row of rows) s.put(row); }),
    remove: (ids) => run('readwrite', (s) => { for (const id of ids) s.delete(id); }),
    clear: () => run('readwrite', (s) => s.clear()),
  };
}

/** A store that keeps things only for this session. */
export function memoryAdapter(seed = []) {
  let rows = [...seed];
  return {
    load: async () => [...rows],
    put: async (more) => {
      const ids = new Set(more.map((row) => row.id));
      rows = [...rows.filter((row) => !ids.has(row.id)), ...more];
    },
    remove: async (ids) => {
      const gone = new Set(ids);
      rows = rows.filter((row) => !gone.has(row.id));
    },
    clear: async () => { rows = []; },
  };
}

// -- the vault --------------------------------------------------------------------

/**
 * Passages, searchable.
 *
 * Two kinds of row: the built-in pack (`origin: 'pacote'`), loaded fresh every
 * session and never stored, so an update to the app updates it; and yours
 * (`origin: 'voce'`), stored. Only yours can be deleted, and "esquecer tudo"
 * forgets only yours.
 */
export class Knowledge {
  constructor({ adapter = null, now = () => Date.now() } = {}) {
    this.adapter = adapter ?? indexedAdapter('conhecimento') ?? memoryAdapter();
    this.now = now;
    this.rows = [];
    this.keys = [];
    this.seen = new Set();
  }

  /** Read what was stored. Never throws: an unreadable store is an empty one. */
  async open() {
    let stored = [];
    try {
      stored = (await this.adapter.load()) ?? [];
    } catch {
      stored = [];
    }
    this._index(stored.filter((row) => row && typeof row.text === 'string'));
    return this;
  }

  _index(rows) {
    for (const row of rows) {
      if (this.seen.has(row.hash)) continue;
      this.seen.add(row.hash);
      this.rows.push(row);
      this.keys.push(embed(focus(`${row.title} ${row.text}`)));
    }
  }

  /**
   * Built-in documents: indexed for this session, not stored.
   * @param {Array<{title: string, text: string, source?: string}>} docs
   */
  seed(docs = []) {
    const rows = [];
    for (const doc of docs) {
      rows.push(...this._rows(doc.text, { title: doc.title, source: doc.source ?? 'pacote do Jarvis', origin: 'pacote' }));
    }
    this._index(rows);
    return rows.length;
  }

  _rows(text, { title = '', source = '', origin = 'voce' } = {}) {
    const doc = `d${digest(`${source}|${title}`)}`;
    const at = this.now();
    return chunk(text).map((passage, i) => {
      const hash = digest(passage);
      return { id: `k${hash}${i.toString(36)}`, doc, title, source, origin, text: passage, hash, at };
    }).filter((row) => !this.seen.has(row.hash));
  }

  /**
   * Add a document of yours. Passages already known (by content) are skipped,
   * so importing the same folder twice changes nothing.
   * @returns {Promise<{added: number, skipped: number}>}
   */
  async add(text, { title = '', source = 'você' } = {}) {
    const all = chunk(text).length;
    const rows = this._rows(text, { title, source, origin: 'voce' });
    if (rows.length) {
      try {
        await this.adapter.put(rows);
      } catch {
        /* Full or blocked: still useful for this session. */
      }
      this._index(rows);
    }
    return { added: rows.length, skipped: all - rows.length };
  }

  /** A file from the picker, whatever its kind. */
  async importFile(name, content) {
    let added = 0;
    let skipped = 0;
    for (const doc of readFile(name, content)) {
      const result = await this.add(doc.text, { title: doc.title, source: name });
      added += result.added;
      skipped += result.skipped;
    }
    return { added, skipped };
  }

  /**
   * The passages about this text, best first, each with its score.
   * A title that matches counts a little extra: it is the author's own summary.
   */
  search(text, { count = TOP, floor = FLOOR } = {}) {
    const subject = focus(text);
    if (!this.rows.length || !subject) return [];
    const query = embed(subject);
    const words = new Set(fold(text).split(/[^a-z0-9]+/).filter((word) => word.length > 3));
    const scored = [];
    for (let i = 0; i < this.rows.length; i += 1) {
      let score = dot(query, this.keys[i]);
      if (score < floor * 0.7) continue;
      const title = fold(this.rows[i].title);
      if (title && [...words].some((word) => title.includes(word))) score += 0.08;
      if (score >= floor) scored.push({ row: this.rows[i], score });
    }
    return scored.sort((a, b) => b.score - a.score).slice(0, count);
  }

  /**
   * The system message for this text, or '' when nothing in the vault is
   * about it -- which is the common case, and costs no tokens.
   */
  contextFor(text, { count = TOP, budget = BUDGET } = {}) {
    const found = this.search(text, { count });
    if (!found.length) return '';
    const lines = [
      'Trechos do vault de conhecimento desta pessoa e do manual do Jarvis, os mais ligados à mensagem. ' +
      'Use se responderem à pergunta e cite a origem quando usar; se não vierem ao caso, ignore.',
    ];
    let used = 0;
    for (const { row } of found) {
      const line = `- (de: ${row.source}${row.title && row.title !== row.source ? ` — ${row.title}` : ''}) ${row.text}`;
      if (used + line.length > budget) break;
      lines.push(line);
      used += line.length;
    }
    return lines.length > 1 ? lines.join('\n') : '';
  }

  /** Your documents, with how many passages each, newest first. */
  documents() {
    const docs = new Map();
    for (const row of this.rows) {
      if (row.origin !== 'voce') continue;
      const entry = docs.get(row.doc) ?? { doc: row.doc, title: row.title, source: row.source, passages: 0, at: 0, bytes: 0 };
      entry.passages += 1;
      entry.bytes += row.text.length;
      entry.at = Math.max(entry.at, row.at);
      docs.set(row.doc, entry);
    }
    return [...docs.values()].sort((a, b) => b.at - a.at);
  }

  /** Counts for the settings sheet. */
  stats() {
    const mine = this.rows.filter((row) => row.origin === 'voce');
    return {
      passages: mine.length,
      documents: new Set(mine.map((row) => row.doc)).size,
      bytes: mine.reduce((sum, row) => sum + row.text.length, 0),
      builtIn: this.rows.length - mine.length,
    };
  }

  /** Drop one of your documents, every passage of it. */
  async forget(doc) {
    const gone = [];
    for (let i = this.rows.length - 1; i >= 0; i -= 1) {
      if (this.rows[i].doc === doc && this.rows[i].origin === 'voce') {
        gone.push(this.rows[i].id);
        this.seen.delete(this.rows[i].hash);
        this.rows.splice(i, 1);
        this.keys.splice(i, 1);
      }
    }
    if (gone.length) await this.adapter.remove(gone).catch(() => {});
    return gone.length;
  }

  /** Forget everything of yours. The built-in pack stays: it is the app, not your data. */
  async clear() {
    const docs = new Set(this.rows.filter((row) => row.origin === 'voce').map((row) => row.doc));
    let gone = 0;
    for (const doc of docs) gone += await this.forget(doc);
    await this.adapter.clear().catch(() => {});
    return gone;
  }

  /** Your passages as one Markdown note per document, for an Obsidian vault. */
  toMarkdown() {
    return this.documents().map((doc) => {
      const text = this.rows.filter((row) => row.doc === doc.doc).map((row) => row.text).join('\n\n');
      return `# ${doc.title || doc.source}\n\n_origem: ${doc.source}_\n\n${text}\n`;
    }).join('\n---\n\n');
  }
}

/**
 * "aprenda isso: …", "guarde que …", "memorize: …" -- a fact to keep.
 * Returns the fact, or null. Not "aprenda a habilidade", which is `skills.js`.
 */
export function learning(text) {
  const said = String(text ?? '').trim();
  if (/^(jarvis[, ]+)?(aprend[ae]|ensin[ao])\s+(a|uma)\s+habilidade/i.test(said)) return null;
  const found = said.match(/^(?:jarvis[, ]+)?(?:aprend[ae]|guard[ae]|memoriz[ae]|anot[ae]|lembr[ae]-se)(?:\s+(?:isso|isto|que|de que|esta informa[cç][aã]o))?\s*[:,-]?\s+([\s\S]{8,})$/i);
  return found ? found[1].trim() : null;
}
