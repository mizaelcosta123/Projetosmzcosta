/**
 * Any figure, from any model: the ```holograma block.
 *
 * The `conjure` tool only exists behind a Jarvis server, and only for models
 * that call tools well. Talking straight to OpenRouter or to an Ollama in
 * Termux there is no tool at all -- and a 1.5B model asked to call one mostly
 * writes prose about calling one. What every model *can* do is write a fenced
 * block, the same way `preview.js` already takes ```html out of a reply. So
 * the model describes the figure as parts, in JSON, inside ```holograma, and
 * the app builds it (`holo.js` → `compose`).
 *
 * Small models write sloppy JSON. The reader here forgives what is easy to
 * forgive -- a trailing comma, single quotes, bare keys, comments -- and
 * clamps every number, because a figure that is a little off is a figure,
 * and one with a coordinate of 1e308 is a frozen phone.
 */

import { codeBlocks } from './preview.js';
import { DETAIL, GENERATORS, LIMITS, SOLIDS, clampDetail, nounOf } from './holo.js';
import { NAMES, PLACES, SIZES, hueFor } from './conjure.js';
import { fold } from './memory.js';

/** The fence languages that mean "build this". */
const LANGUAGES = new Set(['holograma', 'hologram', 'holo', 'holograma3d']);

const ACTIONS = {
  criar: ['criar', 'cria', 'create', 'novo', 'new', 'fazer', 'make'],
  redesenhar: ['redesenhar', 'redesenha', 'redraw', 'editar', 'edit', 'mudar', 'muda',
    'atualizar', 'update', 'alterar', 'modificar', 'refazer'],
  girar: ['girar', 'gira', 'rotate', 'virar', 'turn', 'rodar'],
  apagar: ['apagar', 'apaga', 'remover', 'remove', 'delete', 'excluir', 'limpar', 'tirar'],
};

/** English and accented spellings a model might use, onto the keys `compose` knows. */
const SHAPE_WORDS = {
  ...Object.fromEntries(Object.entries(NAMES).map(([key, words]) => [key, words])),
  torno: ['torno', 'lathe', 'revolucao', 'revolution'],
  extrusao: ['extrusao', 'extrude', 'extrusion'],
  linhas: ['linhas', 'lines', 'polilinha', 'polyline'],
};
const SHAPE_OF = new Map();
for (const [key, words] of Object.entries(SHAPE_WORDS)) {
  SHAPE_OF.set(key, key);
  for (const word of words) if (!SHAPE_OF.has(word)) SHAPE_OF.set(word, key);
}

/** First key present on `object` among `names`. */
function field(object, ...names) {
  for (const name of names) if (object && object[name] !== undefined) return object[name];
  return undefined;
}

/**
 * JSON, forgiving the mistakes small models make.
 *
 * Tried strictly first, so valid JSON is never "repaired" into something else.
 */
export function loose(text) {
  const source = String(text ?? '').trim();
  try {
    return JSON.parse(source);
  } catch {
    // fall through to the repairs
  }
  let fixed = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:"'])\/\/.*$/gm, '$1')
    .replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_, body) => JSON.stringify(body))
    .replace(/([{,]\s*)([A-Za-zÀ-ÿ_][\wÀ-ÿ]*)\s*:/g, '$1"$2":')
    .replace(/,\s*([}\]])/g, '$1');
  // A reply cut off mid-block: close what is open, so the parts that did
  // arrive still build.
  const opens = [];
  let inString = false;
  for (let i = 0; i < fixed.length; i += 1) {
    const c = fixed[i];
    if (c === '"' && fixed[i - 1] !== '\\') inString = !inString;
    if (inString) continue;
    if (c === '{' || c === '[') opens.push(c === '{' ? '}' : ']');
    else if (c === '}' || c === ']') opens.pop();
  }
  if (opens.length) fixed = fixed.replace(/,\s*$/, '') + opens.reverse().join('');
  try {
    return JSON.parse(fixed);
  } catch {
    return null;
  }
}

const finite = (value) => Number.isFinite(Number(value)) && value !== null && value !== '';
const clamp = (value, low, high, fallback) =>
  (finite(value) ? Math.max(low, Math.min(high, Number(value))) : fallback);

function vector(value, low, high, fallback) {
  if (finite(value)) return [0, 1, 2].map(() => clamp(value, low, high, 0));
  if (!Array.isArray(value)) return fallback;
  return [0, 1, 2].map((i) => clamp(value[i], low, high, fallback ? fallback[i] : 0));
}

function shapeOf(value) {
  const word = fold(String(value ?? '')).trim();
  return SHAPE_OF.get(word) ?? null;
}

function pairs(value, most) {
  if (!Array.isArray(value)) return null;
  return value.slice(0, most)
    .filter((row) => Array.isArray(row) && row.length >= 2)
    .map((row) => row.map((v) => clamp(v, -50, 50, 0)));
}

/** One part, from the wire, or null when it names nothing buildable. */
function part(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const shape = shapeOf(field(raw, 'forma', 'shape', 'tipo', 'type'));
  if (!shape) return null;
  const out = {
    shape,
    pos: vector(field(raw, 'pos', 'posicao', 'position'), -50, 50, [0, 0, 0]),
    scale: vector(field(raw, 'escala', 'scale', 'tamanho', 'size'), 0.001, 50, [1, 1, 1]),
    rot: vector(field(raw, 'rot', 'rotacao', 'rotation'), -3600, 3600, [0, 0, 0]),
  };
  const hue = hueFor(field(raw, 'cor', 'color', 'colour'));
  if (hue !== null) out.hue = hue;
  const sides = field(raw, 'lados', 'sides');
  if (finite(sides)) out.sides = clamp(sides, 3, 24, 6);
  if (shape === 'torno') out.profile = pairs(field(raw, 'perfil', 'profile'), 40);
  if (shape === 'extrusao') {
    out.outline = pairs(field(raw, 'contorno', 'outline'), 60);
    out.height = clamp(field(raw, 'altura', 'height'), 0.01, 50, 1);
  }
  if (shape === 'linhas') {
    const points = field(raw, 'pontos', 'points');
    out.points = Array.isArray(points)
      ? points.slice(0, LIMITS.points).filter(Array.isArray).map((p) => vector(p, -50, 50, [0, 0, 0]))
      : null;
    const edges = field(raw, 'arestas', 'edges');
    out.edges = Array.isArray(edges)
      ? edges.filter((e) => Array.isArray(e) && Number.isInteger(e[0]) && Number.isInteger(e[1]))
        .map(([a, b]) => [a, b])
      : null;
  }
  if (GENERATORS.includes(shape)) {
    const data = out.profile ?? out.outline ?? out.points;
    if (!data || data.length < 2) return null;
  }
  return out;
}

function actionOf(value, hasParts) {
  const word = fold(String(value ?? '')).trim();
  for (const [action, words] of Object.entries(ACTIONS)) if (words.includes(word)) return action;
  return hasParts || !word ? 'criar' : null;
}

/**
 * One block, read and checked. Null when it asks for nothing this can do.
 *
 * @returns {null|{action: string, name: string, parts: Array|null, shape: string|null,
 *   hue: number|null, size: number|null, where: object|null, rotation: number[]|null,
 *   degrees: number[]|null, detail: number|null, spin: number|null, gender: string}}
 */
export function normalize(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const rawParts = field(raw, 'pecas', 'peças', 'parts', 'partes');
  const parts = Array.isArray(rawParts) ? rawParts.map(part).filter(Boolean).slice(0, LIMITS.parts) : null;
  const action = actionOf(field(raw, 'acao', 'ação', 'action'), Boolean(parts?.length));
  if (!action) return null;

  const name = fold(String(field(raw, 'nome', 'name', 'objeto', 'object') ?? '')).trim().slice(0, 40);
  const shape = shapeOf(field(raw, 'forma', 'shape'));
  const sizeRaw = field(raw, 'tamanho', 'size');
  const size = finite(sizeRaw)
    ? clamp(sizeRaw, 0.03, 1.5, 0.25)
    : Object.hasOwn(SIZES, fold(String(sizeRaw ?? ''))) ? SIZES[fold(String(sizeRaw))] : null;
  const placeRaw = field(raw, 'lugar', 'place', 'onde');
  const where = Array.isArray(placeRaw)
    ? (() => { const [x, y, z] = vector(placeRaw, -5, 5, [0, 0, -1]); return { x, y, z }; })()
    : Object.hasOwn(PLACES, fold(String(placeRaw ?? ''))) ? { ...PLACES[fold(String(placeRaw))] } : null;
  const rotation = field(raw, 'rotacao', 'rotação', 'rotation');
  const degrees = field(raw, 'graus', 'degrees');
  const detail = field(raw, 'detalhe', 'detail');
  const spin = field(raw, 'giro', 'spin');
  const gender = fold(String(field(raw, 'genero', 'gênero', 'gender') ?? '')).slice(0, 1);

  const block = {
    action,
    name,
    parts: parts && parts.length ? parts : null,
    shape: shape && SOLIDS.includes(shape) ? shape : null,
    hue: hueFor(field(raw, 'cor', 'color', 'colour')),
    size,
    where,
    rotation: rotation === undefined ? null : vector(rotation, -3600, 3600, [0, 0, 0]),
    degrees: degrees === undefined ? null : vector(degrees, -3600, 3600, [0, 0, 0]),
    detail: finite(detail) ? clampDetail(detail) : null,
    spin: spin === true ? 0.6 : spin === false ? 0 : finite(spin) ? clamp(spin, -6, 6, 0.4) : null,
    gender: gender === 'f' || gender === 'm' ? gender : '',
  };
  // A create with nothing to build is not a request.
  if (action === 'criar' && !block.parts && !block.shape) return null;
  return block;
}

/** Every ```holograma block in a reply, read. Unreadable ones are dropped. */
export function parseBlocks(reply) {
  return codeBlocks(reply)
    .filter((block) => LANGUAGES.has(block.language))
    .flatMap((block) => {
      const data = loose(block.code);
      return Array.isArray(data) ? data : [data];
    })
    .map(normalize)
    .filter(Boolean);
}

/** Does the reply carry a block that tried to build something, readable or not? */
export function hasBlock(reply) {
  return codeBlocks(reply).some((block) => LANGUAGES.has(block.language));
}

/**
 * The reply as it should be read or shown: without the blocks.
 *
 * Also hides one still being streamed -- an opening fence with no close yet
 * -- or the caption would flash JSON at somebody while the figure is coming.
 */
export function hideBlocks(text, languages = LANGUAGES) {
  let out = String(text ?? '');
  const names = [...languages].join('|');
  out = out.replace(new RegExp('```(?:' + names + ')[^\\S\\n]*\\n[\\s\\S]*?```', 'gi'), '');
  out = out.replace(new RegExp('```(?:' + names + ')\\b[\\s\\S]*$', 'i'), '');
  return out.replace(/\n{3,}/g, '\n\n').trim();
}

const RAD = Math.PI / 180;

/**
 * Carry one block out on a scene. Returns what to say, or null.
 *
 * `redesenhar` is the "redraw it, in small details or large" of the request:
 * the parts are replaced, and the place, the turn and the size stay where
 * they were, so the figure changes in front of you rather than jumping.
 */
export function apply(scene, block) {
  if (!block) return null;
  const target = block.name ? scene.find(block.name) : null;

  if (block.action === 'apagar') {
    const gone = target ?? (block.name ? null : scene.last());
    if (!gone) return null;
    scene.remove(gone.id);
    return `Apaguei ${nounOf(gone)}.`;
  }

  if (block.action === 'girar') {
    const item = target ?? scene.last();
    if (!item) return null;
    turnBy(item, block);
    return `Girei ${nounOf(item)}.`;
  }

  if (block.action === 'redesenhar' && (target || scene.last())) {
    const item = target ?? scene.last();
    const changes = {};
    if (block.parts) changes.spec = { parts: block.parts };
    else if (block.shape) changes.shape = block.shape;
    if (block.detail !== null) changes.detail = block.detail;
    if (block.hue !== null) changes.hue = block.hue;
    if (block.size !== null) changes.size = block.size;
    if (block.where) Object.assign(changes, block.where);
    if (block.name && !target) changes.name = block.name;
    if (block.gender) changes.gender = block.gender;
    if (!Object.keys(changes).length && block.rotation === null && block.degrees === null && block.spin === null) return null;
    scene.update(item.id, changes);
    turnBy(item, block);
    return `Redesenhei ${nounOf(item)}.`;
  }
  if (block.action === 'redesenhar' && !block.parts && !block.shape) return null;

  // criar, or a redraw with nothing to redraw yet.
  const item = scene.add({
    ...(block.parts ? { spec: { parts: block.parts } } : { shape: block.shape }),
    name: block.name || (block.parts ? 'figura' : block.shape),
    hue: block.hue ?? 195,
    size: block.size ?? (block.parts ? 0.4 : 0.25),
    ...(block.where ?? PLACES.frente),
    detail: block.detail ?? DETAIL,
    spin: block.spin ?? 0.3,
    gender: block.gender,
    label: 'modelo',
  });
  turnBy(item, block);
  return `${nounOf(item, { definite: false, capital: true })}.`;
}

function turnBy(item, block) {
  if (block.rotation) {
    [item.rx, item.angle, item.rz] = block.rotation.map((d) => d * RAD);
  }
  if (block.degrees) {
    item.rx = (item.rx || 0) + block.degrees[0] * RAD;
    item.angle = (item.angle || 0) + block.degrees[1] * RAD;
    item.rz = (item.rz || 0) + block.degrees[2] * RAD;
  }
  if (block.spin !== null) item.spin = block.spin;
  else if (block.rotation || block.degrees) item.spin = 0;
}

/** Every block in a reply, carried out. Returns what to say, joined. */
export function applyAll(scene, reply) {
  const said = parseBlocks(reply).map((block) => apply(scene, block)).filter(Boolean);
  return said.length ? said.join(' ') : null;
}

/**
 * What the model is told about the format. Sent only when the room is
 * involved (`app.js` decides), because a conversation about the weather
 * should not pay for it.
 */
export function roomPrompt() {
  return [
    'Você pode criar hologramas 3D em wireframe na tela. Para criar, mudar, girar ou apagar um,',
    'escreva na resposta um bloco ```holograma com JSON (o bloco não é lido em voz alta; diga em uma frase curta o que fez):',
    '```holograma',
    '{"acao":"criar","nome":"carro","cor":"vermelho","tamanho":"grande","detalhe":3,',
    ' "pecas":[{"forma":"cubo","pos":[0,0.35,0],"escala":[2,0.5,1]},',
    '  {"forma":"cubo","pos":[0,0.75,0],"escala":[1.1,0.4,0.9]},',
    '  {"forma":"cilindro","pos":[0.6,0,0.5],"escala":[0.4,0.12,0.4],"rot":[90,0,0],"cor":"branco"},',
    '  {"forma":"cilindro","pos":[-0.6,0,0.5],"escala":[0.4,0.12,0.4],"rot":[90,0,0],"cor":"branco"}]}',
    '```',
    `Formas: ${SOLIDS.join(', ')}. Cada forma ocupa uma caixa de 1×1×1 centrada em pos; "escala" estica [x,y,z]; "rot" gira em graus [x,y,z]; y é para cima.`,
    'Também: {"forma":"torno","perfil":[[raio,y],...]} gira um perfil (vaso, copo, garrafa);',
    '{"forma":"extrusao","contorno":[[x,z],...],"altura":h} levanta um contorno (letra, planta);',
    '{"forma":"linhas","pontos":[[x,y,z],...],"arestas":[[i,j],...]} para linhas livres.',
    'Monte figuras complexas com várias peças (até 60). Cores: azul, ciano, verde, amarelo, laranja, vermelho, rosa, roxo, branco, dourado, marrom, prata.',
    'acao "redesenhar" com o mesmo "nome" troca as peças e mantém o lugar (mande todas as peças da nova versão);',
    'acao "girar" com "graus":[x,y,z] gira; "rotacao":[x,y,z] define o ângulo; "giro":true/false liga ou para o giro;',
    'acao "apagar" com "nome" remove. "detalhe" vai de 1 a 5. "tamanho": minusculo, pequeno, medio, grande, enorme.',
  ].join('\n');
}

/** A part back in the wire's words, rounded, for showing the model what is there. */
function wirePart(p) {
  const r = (v) => Math.round(v * 100) / 100;
  const out = { forma: p.shape };
  if (p.pos.some(Boolean)) out.pos = p.pos.map(r);
  if (p.scale.some((v) => v !== 1)) out.escala = p.scale.map(r);
  if (p.rot.some(Boolean)) out.rot = p.rot.map(r);
  if (p.hue !== undefined) out.cor = p.hue;
  if (p.sides) out.lados = p.sides;
  if (p.profile) out.perfil = p.profile.map((row) => row.map(r));
  if (p.outline) { out.contorno = p.outline.map((row) => row.map(r)); out.altura = r(p.height); }
  if (p.points) out.pontos = p.points.map((row) => row.map(r));
  if (p.edges) out.arestas = p.edges;
  return out;
}

/**
 * What is in the room right now, for the model -- so "deixa as rodas
 * maiores" can be answered by redrawing the car it built, not a new one.
 * Capped: a room full of figures should not cost the whole context window.
 */
export function sceneContext(scene, most = 4000) {
  if (!scene?.items?.length) return '';
  const lines = ['Hologramas na cena agora (do mais antigo ao mais novo):'];
  let used = lines[0].length;
  for (const item of scene.items) {
    const head = {
      nome: item.name,
      cor: item.hue,
      tamanho: Math.round(item.size * 100) / 100,
      detalhe: item.detail,
    };
    if (item.spec) head.pecas = item.spec.parts.map(wirePart);
    else head.forma = item.shape;
    let line = JSON.stringify(head);
    if (used + line.length > most) {
      delete head.pecas;
      head.pecas_omitidas = item.spec ? item.spec.parts.length : 0;
      line = JSON.stringify(head);
      if (used + line.length > most) {
        lines.push('(mais objetos omitidos)');
        break;
      }
    }
    lines.push(line);
    used += line.length;
  }
  return lines.join('\n');
}
