/**
 * From a sentence to a thing in the room.
 *
 * This is deliberately not a model. A model already sits behind the chat and
 * can call `conjure` as a tool with clean arguments (see `perform` below and
 * `tools/holograms.py`); what this is for is the
 * other path — speaking while the camera is up, where a round trip to an
 * endpoint would put a second and a half between "cubo" and a cube. Rules
 * answer instantly and work with no network at all.
 *
 * The learning is real but small, and worth being exact about: it learns
 * *names*. Say "quando eu disser caixa é um cubo" and `caixa` joins the
 * vocabulary, is stored, and works next week. It does not learn grammar, and
 * a sentence the rules miss is handed to the model rather than guessed at —
 * which is the right division: rules for the fast path, the model for the
 * long tail.
 */

import { SOLIDS } from './holo.js';
import { fold, tokens } from './memory.js';

/** Words that mean a shape, before anything is taught. */
export const NAMES = {
  cubo: ['cubo', 'caixa', 'bloco', 'quadrado', 'cube', 'box'],
  esfera: ['esfera', 'bola', 'globo', 'circulo', 'sphere', 'ball'],
  piramide: ['piramide', 'pyramid', 'triangulo', 'cone'],
  toro: ['toro', 'rosquinha', 'anel', 'donut', 'torus', 'ring'],
  plano: ['plano', 'grade', 'chao', 'piso', 'grid', 'floor'],
  eixo: ['eixo', 'eixos', 'seta', 'axis', 'axes'],
};

/** Colours, as hues on the same wheel the field uses. */
export const HUES = {
  azul: 205, ciano: 185, verde: 145, amarelo: 50, laranja: 25,
  vermelho: 0, rosa: 330, roxo: 275, branco: 200, dourado: 45,
};

/**
 * Every way of saying each colour. Adjectives agree with the noun in
 * Portuguese -- "uma bola vermelha" -- and once every word of a command has
 * to be understood, knowing only "vermelho" turned that sentence into one
 * the rules refused.
 */
const COLOUR_WORDS = {
  azul: ['azul', 'blue'],
  ciano: ['ciano', 'cyan'],
  verde: ['verde', 'green'],
  amarelo: ['amarelo', 'amarela', 'yellow'],
  laranja: ['laranja', 'orange'],
  vermelho: ['vermelho', 'vermelha', 'red'],
  rosa: ['rosa', 'pink'],
  roxo: ['roxo', 'roxa', 'purple'],
  branco: ['branco', 'branca', 'white'],
  dourado: ['dourado', 'dourada', 'gold'],
};

/** How big, in metres. */
export const SIZES = {
  minusculo: 0.08, pequeno: 0.14, medio: 0.25, grande: 0.45, enorme: 0.7,
  gigante: 0.9,
};
const SIZE_WORDS = {
  minusculo: ['minusculo', 'minuscula', 'mini', 'tiny'],
  pequeno: ['pequeno', 'pequena', 'small'],
  medio: ['medio', 'media', 'normal'],
  grande: ['grande', 'big', 'large'],
  enorme: ['enorme', 'huge'],
  gigante: ['gigante', 'giant'],
};

/** Portuguese has genders and "Um esfera" reads as broken. */
const FEMININE = new Set(['esfera', 'piramide']);
const article = (shape) => (FEMININE.has(shape) ? 'Uma' : 'Um');

/** Where to put it, relative to where you are looking. Metres. */
export const PLACES = {
  frente: { x: 0, y: 0, z: -1 },
  aqui: { x: 0, y: 0, z: -0.6 },
  direita: { x: 0.6, y: 0, z: -1 },
  esquerda: { x: -0.6, y: 0, z: -1 },
  acima: { x: 0, y: 0.5, z: -1 },
  abaixo: { x: 0, y: -0.5, z: -1 },
  longe: { x: 0, y: 0, z: -2.2 },
};
const PLACE_WORDS = {
  frente: ['frente', 'ahead', 'front'],
  aqui: ['aqui', 'perto', 'here'],
  direita: ['direita', 'right'],
  esquerda: ['esquerda', 'left'],
  acima: ['acima', 'cima', 'alto', 'above', 'up'],
  abaixo: ['abaixo', 'baixo', 'chao', 'below', 'down'],
  longe: ['longe', 'far', 'fundo'],
};

/** What to do. Order matters: the first match wins, so put the specific
 *  verbs before the general ones. */
const VERBS = [
  ['limpar', ['limpa', 'limpar', 'apaga', 'apagar', 'remove', 'remover', 'tira', 'tirar', 'some', 'clear']],
  ['criar', ['cria', 'criar', 'faz', 'fazer', 'poe', 'poem', 'coloca', 'colocar', 'gera', 'gerar', 'desenha', 'add', 'create', 'make']],
  ['pintar', ['pinta', 'pintar', 'muda', 'mudar', 'troca', 'trocar', 'deixa', 'colour', 'color']],
  ['girar', ['gira', 'girar', 'roda', 'rodar', 'spin', 'rotate']],
  ['parar', ['para', 'parar', 'congela', 'stop', 'freeze']],
];

/**
 * Words that may sit around a command without changing it.
 *
 * Everything the rules act on has to be *made of* known words: the verbs, the
 * shapes, colours, sizes and places, and these. A sentence with anything else
 * in it is a sentence for the model. Without this, "tira uma dúvida" cleared
 * the room, "muda de assunto" answered "nada aí para mexer", and "o que é uma
 * pirâmide?" put a pyramid on the screen -- each one swallowing a perfectly
 * ordinary message before the model ever saw it.
 */
const FILLER = new Set([
  'ai', 'la', 'agora', 'ja', 'mais', 'bem', 'pra', 'pro', 'pros', 'pras',
  'me', 'mim', 'minha', 'meu', 'minhas', 'meus', 'sua', 'seu', 'ele', 'ela', 'eles',
  'elas', 'isso', 'isto', 'esse', 'essa', 'este', 'esta', 'aquele', 'aquela', 'uns',
  'umas', 'tudo', 'todos', 'todas', 'objeto', 'objetos', 'holograma', 'hologramas',
  'forma', 'cor', 'tamanho', '3d', 'favor', 'jarvis', 'lado', 'vez',
  'an', 'please', 'that', 'this', 'all', 'everything', 'one', 'object', 'hologram',
  'on', 'at', 'my', 'now',
]);

/** Every spelling any table knows, so leftovers can be counted. */
const KNOWN = new Set([
  ...Object.values(NAMES).flat(),
  ...Object.values(COLOUR_WORDS).flat(),
  ...Object.values(SIZE_WORDS).flat(),
  ...Object.values(PLACE_WORDS).flat(),
  ...VERBS.flatMap(([, spellings]) => spellings),
]);

/** Match a table of key -> spellings against the words in a phrase. */
function pick(table, words) {
  for (const [key, spellings] of Object.entries(table)) {
    if (spellings.some((spelling) => words.includes(spelling))) return key;
  }
  return null;
}

/**
 * A sentence, read.
 *
 * @param {string} text What was said.
 * @param {{aliases?: Record<string, string>}} [known] Names taught since.
 * @returns {{verb: string|null, shape: string|null, hue: number|null,
 *            size: number|null, where: {x,y,z}|null, all: boolean,
 *            heard: string, extra: string[], question: boolean}} `extra`
 *            is every word no table knows; any at all, or a question,
 *            hands the sentence to the model.
 */
export function parse(text, { aliases = {} } = {}) {
  const words = tokens(text);
  const said = fold(text);

  // Taught names first: what somebody defined for themselves outranks the
  // built-in vocabulary, which is what makes teaching one worth anything.
  let shape = null;
  for (const [alias, target] of Object.entries(aliases)) {
    if (words.includes(fold(alias)) && SOLIDS.includes(target)) {
      shape = target;
      break;
    }
  }
  if (!shape) shape = pick(NAMES, words);

  const sizeKey = pick(SIZE_WORDS, words);
  const placeKey = pick(PLACE_WORDS, words);
  const colourKey = pick(COLOUR_WORDS, words);

  let verb = null;
  for (const [name, spellings] of VERBS) {
    if (spellings.some((spelling) => words.includes(spelling))) {
      verb = name;
      break;
    }
  }
  // Words none of the tables know, taught aliases aside.
  const taught = new Set(Object.keys(aliases).map(fold));
  const extra = words.filter((word) => !KNOWN.has(word) && !FILLER.has(word) && !taught.has(word));

  // "um cubo" on its own is a request for a cube. Speech is clipped, and
  // demanding a verb would reject half of what anybody actually says.
  if (!verb && shape) verb = 'criar';

  return {
    verb,
    shape,
    hue: colourKey ? HUES[colourKey] : null,
    size: sizeKey ? SIZES[sizeKey] : null,
    where: placeKey ? { ...PLACES[placeKey] } : null,
    // "limpa tudo" is different from "limpa o cubo".
    all: /\b(tudo|todos|todas|all|everything)\b/.test(said),
    heard: String(text ?? '').trim(),
    extra,
    question: /\?/.test(said) ||
      /^\s*(o que|oque|que|qual|quais|quem|como|quando|onde|por ?que|quanto|what|how|why|which|who)\b/.test(said),
  };
}

/**
 * Is somebody teaching a word?
 *
 * "quando eu disser caixa é um cubo", "caixa quer dizer cubo", "chamo de
 * bloco o cubo". Returns `{alias, shape}` or null.
 */
export function teaching(text, { aliases = {} } = {}) {
  const said = fold(text);
  const patterns = [
    /quando eu disser (\w+)[, ]+(?:e|eh|é|significa|quer dizer)\s+(?:um |uma |o |a )?(\w+)/,
    /(\w+)\s+(?:quer dizer|significa|e o mesmo que|eh)\s+(?:um |uma |o |a )?(\w+)/,
    /chamo (?:de )?(\w+)\s+(?:o |a )?(\w+)/,
    /(\w+)\s+e\s+(?:um |uma )(\w+)/,
  ];
  for (const pattern of patterns) {
    const found = said.match(pattern);
    if (!found) continue;
    const [, alias, word] = found;
    // The right-hand side has to name something he can actually build, or
    // this would happily record "banana means guitar".
    const shape = SOLIDS.includes(word)
      ? word
      : Object.entries(NAMES).find(([, spellings]) => spellings.includes(word))?.[0] ?? null;
    if (!shape || alias === word) continue;
    // Teaching a word that already means something else is allowed — people
    // rename things — but teaching a word to mean what it already means is
    // not worth storing.
    if (aliases[alias] === shape) continue;
    return { alias, shape };
  }
  return null;
}

/**
 * Carry out what was said, on a scene.
 *
 * Returns a sentence to say back, or null when nothing was understood —
 * and null is the signal to hand the text to the model instead of guessing.
 *
 * @param {import('./holo.js').Scene} scene
 * @param {string} text
 * @param {{aliases?: Record<string, string>}} [known]
 */
export function conjure(scene, text, known = {}) {
  const said = parse(text, known);
  if (!said.verb) return null;
  // Anything the rules do not understand makes the whole sentence the
  // model's. Guessing from half a sentence is how "tira uma dúvida" emptied
  // the room.
  if (said.extra.length > 0) return null;
  // A question about a shape is not a request for one, and the words of a
  // question are mostly ones the index throws away ("que", "é"), so they do
  // not show up as leftovers.
  if (said.question) return null;

  if (said.verb === 'limpar') {
    if (said.all || !said.shape) {
      const gone = scene.clear();
      return gone ? `Limpei ${gone} ${gone === 1 ? 'objeto' : 'objetos'}.` : 'Não havia nada.';
    }
    const match = [...scene.items].reverse().find((item) => item.shape === said.shape);
    if (!match) return `Não tem ${article(said.shape).toLowerCase()} ${said.shape} aí.`;
    scene.remove(match.id);
    return `Tirei ${FEMININE.has(said.shape) ? 'a' : 'o'} ${said.shape}.`;
  }

  if (said.verb === 'criar') {
    if (!said.shape) return null;
    scene.add({
      shape: said.shape,
      hue: said.hue ?? 195,
      size: said.size ?? 0.25,
      ...(said.where ?? PLACES.frente),
      label: said.heard,
    });
    return `${article(said.shape)} ${said.shape}.`;
  }

  // The rest act on something already there: the named one, else the last.
  const target = said.shape
    ? [...scene.items].reverse().find((item) => item.shape === said.shape)
    : scene.last();
  if (!target) return 'Não tem nada aí para mexer.';

  if (said.verb === 'pintar') {
    if (said.hue === null && said.size === null && !said.where) return null;
    scene.update(target.id, {
      ...(said.hue !== null ? { hue: said.hue } : {}),
      ...(said.size !== null ? { size: said.size } : {}),
      ...(said.where ?? {}),
    });
    return 'Pronto.';
  }
  if (said.verb === 'girar') {
    scene.update(target.id, { spin: target.spin === 0 ? 0.8 : target.spin * 1.8 });
    return 'Girando.';
  }
  if (said.verb === 'parar') {
    scene.update(target.id, { spin: 0 });
    return 'Parado.';
  }
  return null;
}

/** What the model may ask for through the `conjure` tool. */
export const ACTIONS = ['criar', 'limpar', 'mudar', 'girar', 'parar'];

/** The most objects one call may make. Mirrors the tool's schema. */
export const MOST = 6;

/**
 * Carry out a tool call from the model, on a scene.
 *
 * The same outcomes as `conjure`, reached from clean arguments instead of a
 * sentence: the model has already done the understanding, so nothing here
 * guesses. Names outside the tables are ignored rather than obeyed -- the
 * tool refuses them server-side, so one arriving here is a mismatch between
 * the two, and doing nothing is the safe way to find out.
 *
 * @param {import('./holo.js').Scene} scene
 * @param {{action?: string, shape?: string, color?: string, size?: string,
 *          place?: string, count?: number}} args
 * @returns {string|null} What happened, or null when nothing did.
 */
export function perform(scene, args = {}) {
  const action = args.action ? args.action : 'criar';
  if (!ACTIONS.includes(action)) return null;
  const shape = SOLIDS.includes(args.shape) ? args.shape : null;
  // `Object.hasOwn`, not `in`: "toString" is *in* every object.
  const hue = Object.hasOwn(HUES, args.color ?? '') ? HUES[args.color] : null;
  const size = Object.hasOwn(SIZES, args.size ?? '') ? SIZES[args.size] : null;
  const where = Object.hasOwn(PLACES, args.place ?? '') ? { ...PLACES[args.place] } : null;

  if (action === 'limpar') {
    if (!shape) {
      const gone = scene.clear();
      return gone ? `Limpei ${gone} ${gone === 1 ? 'objeto' : 'objetos'}.` : 'Não havia nada.';
    }
    const match = [...scene.items].reverse().find((item) => item.shape === shape);
    if (!match) return null;
    scene.remove(match.id);
    return `Tirei ${FEMININE.has(shape) ? 'a' : 'o'} ${shape}.`;
  }

  if (action === 'criar') {
    if (!shape) return null;
    const count = Math.max(1, Math.min(MOST, Math.round(Number(args.count) || 1)));
    const base = where ?? { ...PLACES.frente };
    const each = size ?? 0.25;
    // Side by side, centred on the place asked for, a little apart.
    const step = each * 1.4;
    for (let i = 0; i < count; i += 1) {
      scene.add({
        shape,
        hue: hue ?? 195,
        size: each,
        ...base,
        x: base.x + (i - (count - 1) / 2) * step,
        label: 'modelo',
      });
    }
    const noun = count === 1 ? shape : `${shape}s`;
    return count === 1 ? `${article(shape)} ${shape}.` : `${count} ${noun}.`;
  }

  const target = shape
    ? [...scene.items].reverse().find((item) => item.shape === shape)
    : scene.last();
  if (!target) return null;
  if (action === 'mudar') {
    if (hue === null && size === null && !where) return null;
    scene.update(target.id, {
      ...(hue !== null ? { hue } : {}),
      ...(size !== null ? { size } : {}),
      ...(where ?? {}),
    });
    return 'Pronto.';
  }
  if (action === 'girar') {
    scene.update(target.id, { spin: target.spin === 0 ? 0.8 : target.spin * 1.8 });
    return 'Girando.';
  }
  scene.update(target.id, { spin: 0 });
  return 'Parado.';
}

/**
 * Read the taught names out of a memory store.
 *
 * Kept here rather than in `memory.js` so the store stays a store: it holds
 * episodes and knows nothing about cubes.
 */
export function learnedNames(memory) {
  const aliases = {};
  for (const row of memory?.rows ?? []) {
    if (row.kind !== 'apelido') continue;
    const found = teaching(row.text);
    if (found) aliases[found.alias] = found.shape;
  }
  return aliases;
}
