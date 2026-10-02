/**
 * The skills catalogue: how to do a kind of task well, chosen per message.
 *
 * A skill is not code and not a model. It is a short recipe -- when it
 * applies, and what a good answer to that kind of request looks like -- put
 * in front of the model only when the request is that kind. "Escreve um
 * e-mail pedindo reembolso" gets the e-mail recipe (subject line, one ask,
 * polite close); "bom dia" gets nothing, and pays nothing.
 *
 * Chosen by the same retrieval as the memory and the vault, against each
 * skill's `quando` and its examples, so picking one costs no request.
 *
 * The built-in catalogue lives in `skills/*.json`; yours (taught by voice or
 * imported) lives in IndexedDB next to the vault, and outranks a built-in one
 * with the same id.
 */

import { dot, embed, fold } from './memory.js';
import { focus, indexedAdapter, memoryAdapter } from './knowledge.js';

/** Below this a skill only shares a word with the request. */
export const FLOOR = 0.55;
/** And close to the best one, so a far second does not ride along. */
export const NEAR = 0.75;
/** How many recipes one message gets. Two is already a lot of instructions. */
export const TOP = 2;

/** The built-in packs, by file. `app.js` fetches these; tests read them from disk. */
export const PACKS = [
  'escrita', 'estudo', 'codigo', 'financas', 'viagem', 'saude',
  'culinaria', 'produtividade', 'casa', 'hologramas', 'conhecimento', 'apis',
];

/**
 * Check one skill and fill what is optional. Null when it cannot be one --
 * a skill with no `quando` would match nothing, and one with no instructions
 * would match and say nothing.
 */
export function validate(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const quando = String(raw.quando ?? raw.when ?? '').trim();
  const instrucoes = String(raw.instrucoes ?? raw.instructions ?? '').trim();
  if (!quando || !instrucoes) return null;
  const nome = String(raw.nome ?? raw.name ?? quando).trim().slice(0, 80);
  const id = String(raw.id ?? fold(nome).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')).slice(0, 60);
  const exemplos = (Array.isArray(raw.exemplos ?? raw.examples) ? (raw.exemplos ?? raw.examples) : [])
    .map(String).filter(Boolean).slice(0, 12);
  const apis = (Array.isArray(raw.apis) ? raw.apis : []).map(String).slice(0, 6);
  return {
    id,
    nome,
    categoria: String(raw.categoria ?? raw.category ?? 'geral'),
    quando: quando.slice(0, 400),
    instrucoes: instrucoes.slice(0, 1500),
    exemplos,
    apis,
    origem: raw.origem === 'voce' ? 'voce' : 'pacote',
  };
}

export class Skills {
  constructor({ adapter = null } = {}) {
    this.adapter = adapter ?? indexedAdapter('habilidades') ?? memoryAdapter();
    this.list = [];
    this.keys = [];
  }

  /** Read yours from storage. */
  async open() {
    let stored = [];
    try {
      stored = (await this.adapter.load()) ?? [];
    } catch {
      stored = [];
    }
    this.add(stored.map((row) => ({ ...row, origem: 'voce' })));
    return this;
  }

  /**
   * Take skills into the catalogue (built-in or yours). A later one with the
   * same id replaces an earlier one, except that a built-in never replaces
   * yours. Returns how many were taken.
   */
  add(rows = []) {
    let taken = 0;
    for (const raw of rows) {
      const skill = validate(raw);
      if (!skill) continue;
      const at = this.list.findIndex((row) => row.id === skill.id);
      if (at >= 0) {
        if (this.list[at].origem === 'voce' && skill.origem !== 'voce') continue;
        this.list[at] = skill;
        this.keys[at] = keysFor(skill);
      } else {
        this.list.push(skill);
        this.keys.push(keysFor(skill));
      }
      taken += 1;
    }
    return taken;
  }

  /** Teach one and keep it. */
  async learn(raw) {
    const skill = validate({ ...raw, origem: 'voce' });
    if (!skill) return null;
    this.add([skill]);
    await this.adapter.put([skill]).catch(() => {});
    return skill;
  }

  /** Forget one of yours. A built-in one cannot be: it is part of the app. */
  async forget(id) {
    const at = this.list.findIndex((row) => row.id === id && row.origem === 'voce');
    if (at < 0) return false;
    this.list.splice(at, 1);
    this.keys.splice(at, 1);
    await this.adapter.remove([id]).catch(() => {});
    return true;
  }

  /** The skills for this request, best first. Empty when none really fits. */
  pick(text, { count = TOP, floor = FLOOR } = {}) {
    const subject = focus(text);
    if (!this.list.length || !subject) return [];
    const query = embed(subject);
    const scored = [];
    for (let i = 0; i < this.list.length; i += 1) {
      // The best of its `quando` and its examples: a request usually sounds
      // like one example, not like the average of them.
      let best = 0;
      for (const key of this.keys[i]) best = Math.max(best, dot(query, key));
      if (best >= floor) scored.push({ skill: this.list[i], score: best });
    }
    return scored.sort((a, b) => b.score - a.score)
      .filter(({ score }, _, all) => score >= all[0].score * NEAR)
      .slice(0, count);
  }

  /** The system message for this request, or '' -- and '' is the usual answer. */
  contextFor(text, options) {
    const picked = this.pick(text, options);
    if (!picked.length) return '';
    return [
      'Habilidades do Jarvis que servem para este pedido. Siga as instruções se o pedido for mesmo desse tipo:',
      ...picked.map(({ skill }) => `## ${skill.nome}\n${skill.instrucoes}`),
    ].join('\n');
  }

  /** Counts for the settings sheet. */
  stats() {
    const mine = this.list.filter((row) => row.origem === 'voce').length;
    return { total: this.list.length, mine, categories: new Set(this.list.map((row) => row.categoria)).size };
  }

  /** Yours, as a pack anyone can import. */
  export() {
    return JSON.stringify(this.list.filter((row) => row.origem === 'voce'), null, 2);
  }
}

function keysFor(skill) {
  return [`${skill.nome}. ${skill.quando}`, ...skill.exemplos].map((text) => embed(focus(text)));
}

/**
 * "aprenda a habilidade: quando eu pedir X, faça Y" -- a recipe taught by voice.
 * Returns `{quando, instrucoes, nome}` or null.
 */
export function teachingSkill(text) {
  const said = String(text ?? '').trim();
  const found = said.match(/^(?:jarvis[, ]+)?(?:aprend[ae]|ensin[ao]|cri[ae]|grav[ae])\s+(?:a|uma|essa|esta)\s+(?:nova\s+)?habilidade\s*[:,-]?\s*(?:quando\s+(?:eu\s+)?(?:pedir|disser|falar|quiser|perguntar)(?:\s+(?:para|pra))?\s+)?([\s\S]+?)\s*[,;.]\s*(?:voc[eê]\s+)?(?:fa[cç]a|faz|responda|responde|use|usa|siga|segue|mostre|mostra|devolva|me\s+d[eêá])\s+([\s\S]{4,})$/i);
  if (!found) return null;
  const quando = found[1].trim().replace(/^["“]|["”]$/g, '');
  const instrucoes = found[2].trim();
  return { nome: quando.slice(0, 60), quando, instrucoes, exemplos: [quando] };
}
