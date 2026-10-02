/**
 * Vector solids, as wireframes, for drawing in the air.
 *
 * Wireframe and not surfaces, and that is a decision rather than a shortcut.
 * A hologram reads as a hologram because you can see through it: edges over
 * a live camera feed sit in the room, while shaded faces read as a sticker
 * on the glass. Edges are also what a phone can draw at sixty frames while
 * the camera is running, and they are exactly what the particle field
 * already is — so the two look like they belong to the same object.
 *
 * Everything here is arithmetic: no canvas, no WebGL, no browser. Which is
 * why the geometry can be tested at all.
 */

/**
 * The shapes he knows how to make by name.
 *
 * The first six are the originals; the rest arrived when "any figure" became
 * the brief. A figure that is none of these -- a car, a house, a vase -- is
 * not a seventh name here: it is *composed* from these (see `compose`), which
 * is how a phone gets "anything" without a mesh library.
 */
export const SOLIDS = [
  'cubo', 'esfera', 'piramide', 'toro', 'plano', 'eixo',
  'cilindro', 'cone', 'tetraedro', 'octaedro', 'icosaedro', 'dodecaedro',
  'prisma', 'estrela', 'helice', 'capsula', 'disco', 'linha',
];

/**
 * Parts that are not a fixed solid but a recipe: a profile turned on a lathe,
 * an outline pulled up into a wall, or free lines. Only `compose` builds them,
 * because they mean nothing without their data.
 */
export const GENERATORS = ['torno', 'extrusao', 'linhas'];

/** How a name is written for people, where it differs from the key. */
export const LABELS = { piramide: 'pirâmide', helice: 'hélice', capsula: 'cápsula' };

/** Names that take "a"/"uma". Everything else here is masculine. */
const FEMININE = new Set(['esfera', 'piramide', 'estrela', 'helice', 'capsula', 'linha']);

/** 1..5. Three is what the six originals always drew, so nothing old changed. */
export const DETAIL = 3;
const SEGMENTS = [6, 8, 12, 16, 24];

/** Hard limits: past these a phone stops being sixty frames. */
export const LIMITS = { parts: 60, edges: 2500, scene: 6000, points: 400 };

export const clampDetail = (detail) =>
  Math.max(1, Math.min(5, Math.round(Number(detail) || DETAIL)));
const segmentsFor = (detail) => SEGMENTS[clampDetail(detail) - 1];

/** A point, for readability at the call sites. */
const at = (x, y, z) => ({ x, y, z });

/** Unit cube, centred on the origin. */
function cube() {
  const points = [];
  for (const x of [-0.5, 0.5]) for (const y of [-0.5, 0.5]) for (const z of [-0.5, 0.5]) {
    points.push(at(x, y, z));
  }
  const edges = [];
  for (let i = 0; i < 8; i += 1) {
    for (let j = i + 1; j < 8; j += 1) {
      // Two corners of a cube share an edge exactly when they differ in one
      // coordinate. Cheaper to say than to list twelve pairs, and it cannot
      // be mistyped.
      const a = points[i];
      const b = points[j];
      const differs = (a.x !== b.x) + (a.y !== b.y) + (a.z !== b.z);
      if (differs === 1) edges.push([i, j]);
    }
  }
  return { points, edges };
}

/** A sphere as rings of latitude and longitude, which is what reads as one. */
function sphere({ detail } = {}) {
  const segments = segmentsFor(detail);
  const rings = segments / 2;
  const points = [];
  const edges = [];
  for (let ring = 1; ring < rings; ring += 1) {
    const phi = (ring / rings) * Math.PI;
    const y = Math.cos(phi) * 0.5;
    const radius = Math.sin(phi) * 0.5;
    const first = points.length;
    for (let s = 0; s < segments; s += 1) {
      const theta = (s / segments) * Math.PI * 2;
      points.push(at(Math.cos(theta) * radius, y, Math.sin(theta) * radius));
      edges.push([first + s, first + ((s + 1) % segments)]);
    }
    if (ring > 1) {
      const above = first - segments;
      for (let s = 0; s < segments; s += 1) edges.push([above + s, first + s]);
    }
  }
  return { points, edges };
}

/** Square base, apex above. */
function pyramid() {
  const points = [
    at(-0.5, -0.5, -0.5), at(0.5, -0.5, -0.5), at(0.5, -0.5, 0.5), at(-0.5, -0.5, 0.5),
    at(0, 0.5, 0),
  ];
  return {
    points,
    edges: [[0, 1], [1, 2], [2, 3], [3, 0], [0, 4], [1, 4], [2, 4], [3, 4]],
  };
}

/** A ring of rings. */
function torus({ detail, thickness = 0.18 } = {}) {
  const around = segmentsFor(detail);
  const through = Math.max(4, around / 2);
  const points = [];
  const edges = [];
  const big = 0.5 - thickness;
  for (let i = 0; i < around; i += 1) {
    const u = (i / around) * Math.PI * 2;
    const first = points.length;
    for (let j = 0; j < through; j += 1) {
      const v = (j / through) * Math.PI * 2;
      const r = big + Math.cos(v) * thickness;
      points.push(at(Math.cos(u) * r, Math.sin(v) * thickness, Math.sin(u) * r));
      edges.push([first + j, first + ((j + 1) % through)]);
    }
    const next = ((i + 1) % around) * through;
    for (let j = 0; j < through; j += 1) edges.push([first + j, next + j]);
  }
  return { points, edges };
}

/** A grid on the floor, for showing where the floor is. */
function plane({ detail } = {}) {
  const steps = segmentsFor(detail) / 2;
  const points = [];
  const edges = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps - 0.5;
    const base = points.length;
    points.push(at(t, 0, -0.5), at(t, 0, 0.5), at(-0.5, 0, t), at(0.5, 0, t));
    edges.push([base, base + 1], [base + 2, base + 3]);
  }
  return { points, edges };
}

/** Three lines from the origin. For pointing at where something will go. */
function axes() {
  return {
    points: [at(0, 0, 0), at(0.5, 0, 0), at(0, 0.5, 0), at(0, 0, 0.5)],
    edges: [[0, 1], [0, 2], [0, 3]],
  };
}

/**
 * A profile turned about Y: `profile` is `[[radius, y], …]` from bottom to top.
 *
 * The one generator that makes most round things -- a cylinder, a cone, a
 * capsule, and the vase, bottle and glass the model asks for. A radius of
 * zero is one point on the axis rather than a ring collapsed onto itself,
 * which would be `segments` points stacked in the same place.
 */
export function lathe(profile, { detail } = {}) {
  const segments = segmentsFor(detail);
  const points = [];
  const edges = [];
  let previous = null;
  for (const [radius, y] of profile) {
    const r = Math.abs(radius);
    let ring;
    if (r < 1e-6) {
      ring = [points.length];
      points.push(at(0, y, 0));
    } else {
      ring = [];
      for (let s = 0; s < segments; s += 1) {
        const theta = (s / segments) * Math.PI * 2;
        ring.push(points.length);
        points.push(at(Math.cos(theta) * r, y, Math.sin(theta) * r));
      }
      for (let s = 0; s < segments; s += 1) edges.push([ring[s], ring[(s + 1) % segments]]);
    }
    if (previous) {
      if (previous.length === 1 && ring.length === 1) edges.push([previous[0], ring[0]]);
      else if (previous.length === 1 || ring.length === 1) {
        // To or from the axis: every other spoke is enough to read as a cone,
        // and all of them at detail 5 is a hedgehog.
        const many = previous.length === 1 ? ring : previous;
        const one = previous.length === 1 ? previous[0] : ring[0];
        const step = segments > 12 ? 2 : 1;
        for (let s = 0; s < many.length; s += step) edges.push([one, many[s]]);
      } else {
        for (let s = 0; s < segments; s += 1) edges.push([previous[s], ring[s]]);
      }
    }
    previous = ring;
  }
  return { points, edges };
}

/**
 * An outline on the floor, `[[x, z], …]`, pulled up into a wall `height` tall.
 * Closed: the last corner joins the first. Letters, stars, a house's plan.
 */
export function extrude(outline, height = 1) {
  const points = [];
  const edges = [];
  const n = outline.length;
  for (const y of [-height / 2, height / 2]) {
    for (const [x, z] of outline) points.push(at(x, y, z));
  }
  for (let i = 0; i < n; i += 1) {
    const j = (i + 1) % n;
    edges.push([i, j], [n + i, n + j], [i, n + i]);
  }
  return { points, edges };
}

/** Every pair of points at the shortest distance: how the regular solids are wired. */
function nearest(points) {
  let least = Infinity;
  const gap = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) least = Math.min(least, gap(points[i], points[j]));
  }
  const edges = [];
  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      if (gap(points[i], points[j]) <= least * 1.001) edges.push([i, j]);
    }
  }
  return edges;
}

/** Scaled so the largest coordinate is exactly 0.5 -- the unit box every solid claims. */
function fitted(raw) {
  const most = Math.max(...raw.map(([x, y, z]) => Math.max(Math.abs(x), Math.abs(y), Math.abs(z))));
  const points = raw.map(([x, y, z]) => at((x / most) * 0.5, (y / most) * 0.5, (z / most) * 0.5));
  return { points, edges: nearest(points) };
}

const PHI = (1 + Math.sqrt(5)) / 2;

function cyclic(triples) {
  const out = [];
  for (const [a, b, c] of triples) out.push([a, b, c], [c, a, b], [b, c, a]);
  return out;
}

function signs(values) {
  // Every combination of signs on the non-zero entries, without duplicates.
  let out = [[]];
  for (const v of values) {
    out = out.flatMap((row) => (v === 0 ? [[...row, 0]] : [[...row, v], [...row, -v]]));
  }
  return out;
}

const tetrahedron = () => fitted([[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]]);
const octahedron = () => fitted([[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]);
const icosahedron = () => fitted(cyclic(signs([0, 1, PHI]).map((p) => p)));
const dodecahedron = () => fitted([
  ...signs([1, 1, 1]),
  ...cyclic(signs([0, 1 / PHI, PHI])),
]);

/** An upright prism with `sides` sides -- a hexagonal pencil, a triangular wedge. */
function prism({ sides = 6 } = {}) {
  const n = Math.max(3, Math.min(24, Math.round(sides) || 6));
  const outline = [];
  for (let i = 0; i < n; i += 1) {
    const t = (i / n) * Math.PI * 2;
    outline.push([Math.cos(t) * 0.5, Math.sin(t) * 0.5]);
  }
  return extrude(outline, 1);
}

/** A five-pointed star, standing up and facing you, with some thickness. */
function star({ points: tips = 5 } = {}) {
  const outline = [];
  const n = Math.max(3, Math.min(12, Math.round(tips) || 5));
  for (let i = 0; i < n * 2; i += 1) {
    const t = (i / (n * 2)) * Math.PI * 2 + Math.PI / 2;
    const r = i % 2 === 0 ? 0.5 : 0.2;
    outline.push([Math.cos(t) * r, Math.sin(t) * r]);
  }
  const flat = extrude(outline, 0.16);
  // Built lying down (outline on the floor); stood up so it faces the camera.
  return { points: flat.points.map((p) => at(p.x, p.z, p.y)), edges: flat.edges };
}

/** A spring: three turns climbing the height of the box. */
function helix({ detail, turns = 3 } = {}) {
  const per = segmentsFor(detail);
  const total = per * turns;
  const points = [];
  const edges = [];
  for (let i = 0; i <= total; i += 1) {
    const t = (i / per) * Math.PI * 2;
    points.push(at(Math.cos(t) * 0.4, -0.5 + i / total, Math.sin(t) * 0.4));
    if (i > 0) edges.push([i - 1, i]);
  }
  return { points, edges };
}

function capsule({ detail } = {}) {
  const profile = [[0, -0.5]];
  const steps = Math.max(2, segmentsFor(detail) / 4);
  for (let i = 1; i <= steps; i += 1) {
    const a = (i / steps) * (Math.PI / 2);
    profile.push([Math.sin(a) * 0.25, -0.25 - Math.cos(a) * 0.25]);
  }
  for (let i = 0; i < steps; i += 1) {
    const a = (i / steps) * (Math.PI / 2);
    profile.push([Math.cos(a) * 0.25, 0.25 + Math.sin(a) * 0.25]);
  }
  profile.push([0, 0.5]);
  return lathe(profile, { detail });
}

/** A flat round plate, lying on the floor. */
const disc = ({ detail } = {}) => lathe([[0, 0], [0.5, 0]], { detail });

const BUILDERS = {
  cubo: cube,
  esfera: sphere,
  piramide: pyramid,
  toro: torus,
  plano: plane,
  eixo: axes,
  cilindro: (o) => lathe([[0.5, -0.5], [0.5, 0.5]], o),
  cone: (o) => lathe([[0.5, -0.5], [0, 0.5]], o),
  tetraedro: tetrahedron,
  octaedro: octahedron,
  icosaedro: icosahedron,
  dodecaedro: dodecahedron,
  prisma: prism,
  estrela: star,
  helice: helix,
  capsula: capsule,
  disco: disc,
  linha: () => ({ points: [at(-0.5, 0, 0), at(0.5, 0, 0)], edges: [[0, 1]] }),
};

/**
 * Build one, by name.
 *
 * An unknown name is a cube rather than an error: this is driven by speech,
 * and a request for a "tesserato" should put *something* in the room while
 * he says he does not know that one.
 *
 * @param {string} name
 * @param {{detail?: number, sides?: number}} [options]
 */
export function solid(name, options = {}) {
  const build = BUILDERS[name] ?? BUILDERS.cubo;
  const { points, edges } = build({ ...options, detail: clampDetail(options.detail) });
  return { name: name in BUILDERS ? name : 'cubo', points, edges };
}

// -- composing a figure out of parts ------------------------------------------

const RAD = Math.PI / 180;

/** Rotate a point by `[x, y, z]` degrees, in that order. */
export function turn(point, [rx = 0, ry = 0, rz = 0] = []) {
  let { x, y, z } = point;
  if (rx) {
    const c = Math.cos(rx * RAD); const s = Math.sin(rx * RAD);
    [y, z] = [y * c - z * s, y * s + z * c];
  }
  if (ry) {
    const c = Math.cos(ry * RAD); const s = Math.sin(ry * RAD);
    [x, z] = [x * c + z * s, z * c - x * s];
  }
  if (rz) {
    const c = Math.cos(rz * RAD); const s = Math.sin(rz * RAD);
    [x, y] = [x * c - y * s, x * s + y * c];
  }
  return at(x, y, z);
}

const finite = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
const triple = (value, fallback) => {
  if (Number.isFinite(Number(value))) return [Number(value), Number(value), Number(value)];
  if (!Array.isArray(value)) return [...fallback];
  return [0, 1, 2].map((i) => finite(value[i], fallback[i]));
};

/** The raw geometry of one part, before it is moved into place. */
function partGeometry(part, detail) {
  const shape = part.shape;
  if (shape === 'torno' && Array.isArray(part.profile) && part.profile.length >= 2) {
    const profile = part.profile.slice(0, 40)
      .map(([r, y]) => [finite(r), finite(y)]);
    return lathe(profile, { detail });
  }
  if (shape === 'extrusao' && Array.isArray(part.outline) && part.outline.length >= 3) {
    const outline = part.outline.slice(0, 60).map(([x, z]) => [finite(x), finite(z)]);
    return extrude(outline, Math.max(0.01, finite(part.height, 1)));
  }
  if (shape === 'linhas' && Array.isArray(part.points) && part.points.length >= 2) {
    const points = part.points.slice(0, LIMITS.points)
      .map(([x, y, z]) => at(finite(x), finite(y), finite(z)));
    let edges = Array.isArray(part.edges) && part.edges.length
      ? part.edges.filter((e) => Array.isArray(e)
        && Number.isInteger(e[0]) && Number.isInteger(e[1])
        && e[0] !== e[1]
        && e[0] >= 0 && e[1] >= 0 && e[0] < points.length && e[1] < points.length)
        .map(([a, b]) => [a, b])
      // No edges given: a polyline through the points in order.
      : points.slice(1).map((_, i) => [i, i + 1]);
    if (!edges.length) edges = points.slice(1).map((_, i) => [i, i + 1]);
    return { points, edges };
  }
  if (!(shape in BUILDERS)) return null;
  return solid(shape, { detail, sides: part.sides, points: part.tips });
}

/**
 * Build one figure out of parts.
 *
 * Each part is a solid or a generator, stretched by `scale`, turned by `rot`
 * (degrees) and put at `pos`. The transforms are baked into the points, so
 * the result is an ordinary wireframe the painter and the hands already know.
 * Then the whole is centred and scaled to the unit box every solid claims, so
 * `size` means the same thing for a car as for a cube.
 *
 * A part the browser does not know is skipped, not guessed: a model that
 * invents "roda" as a shape gets the rest of its car, not a cube where the
 * wheel should be.
 *
 * @param {Array<object>} parts `{shape, pos, scale, rot, hue, profile, outline, height, points, edges, sides}`
 * @returns {{points: Array, edges: Array, parts: number}|null} null when nothing was buildable.
 */
export function compose(parts, detail = DETAIL) {
  if (!Array.isArray(parts)) return null;
  const points = [];
  const edges = [];
  let used = 0;
  for (const part of parts.slice(0, LIMITS.parts)) {
    if (!part || typeof part !== 'object') continue;
    const geometry = partGeometry(part, detail);
    if (!geometry || !geometry.edges.length) continue;
    if (edges.length + geometry.edges.length > LIMITS.edges) break;
    const scale = triple(part.scale, [1, 1, 1]).map((v) => Math.max(-50, Math.min(50, v)));
    const pos = triple(part.pos, [0, 0, 0]).map((v) => Math.max(-50, Math.min(50, v)));
    const rot = triple(part.rot, [0, 0, 0]);
    const offset = points.length;
    for (const p of geometry.points) {
      const moved = turn(at(p.x * scale[0], p.y * scale[1], p.z * scale[2]), rot);
      points.push(at(moved.x + pos[0], moved.y + pos[1], moved.z + pos[2]));
    }
    const hue = Number.isFinite(part.hue) ? part.hue : null;
    for (const [a, b] of geometry.edges) {
      edges.push(hue === null ? [offset + a, offset + b] : [offset + a, offset + b, hue]);
    }
    used += 1;
  }
  if (!edges.length) return null;

  // Centre on the bounding box, and fit the largest side to 1.
  const low = { x: Infinity, y: Infinity, z: Infinity };
  const high = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const p of points) {
    for (const axis of ['x', 'y', 'z']) {
      low[axis] = Math.min(low[axis], p[axis]);
      high[axis] = Math.max(high[axis], p[axis]);
    }
  }
  const span = Math.max(high.x - low.x, high.y - low.y, high.z - low.z) || 1;
  const mid = { x: (low.x + high.x) / 2, y: (low.y + high.y) / 2, z: (low.z + high.z) / 2 };
  return {
    points: points.map((p) => at((p.x - mid.x) / span, (p.y - mid.y) / span, (p.z - mid.z) / span)),
    edges,
    parts: used,
  };
}

const MASCULINE_A = new Set(['planeta', 'mapa', 'dia', 'cometa', 'sofá', 'guarda-chuva', 'pijama', 'idioma', 'clima']);

/** Is this name feminine? The model may say so (`gender`); otherwise a guess from the ending. */
function feminine(item) {
  if (item.gender === 'f') return true;
  if (item.gender === 'm') return false;
  const name = item.name ?? item.shape;
  if (FEMININE.has(name)) return true;
  if (name in BUILDERS) return false;
  const last = String(name).toLowerCase().split(/\s+/)[0];
  // The -a words that are masculine anyway, as far as anyone asks for in 3D.
  if (MASCULINE_A.has(last) || /(ema|oma)$/.test(last)) return false;
  return /(a|ção|dade|gem)$/.test(last);
}

/**
 * How to say what something is, with its article: "o cubo", "a casa",
 * "uma pirâmide". Replaces the `item.shape === 'esfera' ? …` spread across
 * the interface, which could not survive "o carro".
 *
 * @param {object} item
 * @param {{definite?: boolean, capital?: boolean}} [options]
 */
export function nounOf(item, { definite = true, capital = false } = {}) {
  const name = item?.name ?? item?.shape ?? 'objeto';
  const label = LABELS[name] ?? name;
  const female = feminine(item ?? {});
  const article = definite ? (female ? 'a' : 'o') : (female ? 'uma' : 'um');
  const said = `${article} ${label}`;
  return capital ? said[0].toUpperCase() + said.slice(1) : said;
}

/** The geometry an item should have, from what it says it is. */
function geometryOf({ shape, spec, detail, sides }) {
  if (spec) {
    const built = compose(spec.parts, detail);
    if (built) return { points: built.points, edges: built.edges };
  }
  const made = solid(shape, { detail, sides });
  return { points: made.points, edges: made.edges };
}

/**
 * A thing in the room. Position in metres, scale in metres, spin in rad/s.
 *
 * `spec` is a composed figure (`{parts}`); without one, `shape` names a
 * solid. `name` is what people call it ("carro"), which is how "redesenha o
 * carro" finds it again. `rx` and `rz` tilt it, in radians, on top of the
 * `angle` it spins through about `spinAxis`.
 */
export function hologram({
  shape = 'cubo', x = 0, y = 0, z = -1, size = 0.25, hue = 195,
  spin = 0.4, id = '', label = '', spec = null, name = '', detail = DETAIL,
  rx = 0, rz = 0, angle = 0, spinAxis = 'y', gender = '', sides,
} = {}) {
  const level = clampDetail(detail);
  const kind = spec ? 'composto' : (shape in BUILDERS ? shape : 'cubo');
  return {
    id: id || `h${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    shape: kind, x, y, z, size, hue, spin, label,
    name: name || kind, spec, detail: level, rx, rz, spinAxis, gender, sides,
    born: 0, angle,
    ...geometryOf({ shape: kind, spec, detail: level, sides }),
  };
}

/** Build an item's geometry again, after its spec, shape or detail changed. */
export function rebuild(item) {
  item.detail = clampDetail(item.detail);
  Object.assign(item, geometryOf(item));
  return item;
}

/**
 * Tilt a point (X, then Z), spin it about Y, then move it. The order matters
 * and is the usual one: turn the object on its own axes, then put it where it
 * goes. The tilt comes before the spin so a car laid on its side still turns
 * about the room's vertical, which is what a turntable looks like.
 */
export function place(point, item) {
  const c = Math.cos(item.angle);
  const s = Math.sin(item.angle);
  // `pulse` swells it with the synthesizer's level (lens.js); zero otherwise.
  const size = item.size * (1 + (item.pulse || 0));
  let x = point.x * size;
  let y = point.y * size;
  let z = point.z * size;
  if (item.rx) {
    const cx = Math.cos(item.rx); const sx = Math.sin(item.rx);
    [y, z] = [y * cx - z * sx, y * sx + z * cx];
  }
  if (item.rz) {
    const cz = Math.cos(item.rz); const sz = Math.sin(item.rz);
    [x, y] = [x * cz - y * sz, x * sz + y * cz];
  }
  return {
    x: item.x + x * c + z * s,
    y: item.y + y,
    z: item.z + z * c - x * s,
  };
}

/**
 * A camera's view of a point, and whether it is worth drawing.
 *
 * Returns screen coordinates in a -1..1 box plus the depth it was at, so the
 * caller can fade and thin distant edges. `visible` is false behind the
 * camera, where the perspective divide would flip the point through the
 * origin and draw a mirror image of the scene.
 *
 * @param {{x,y,z}} point In camera space: -z is forward.
 * @param {number} [fov] Focal length, in the same arbitrary units.
 */
export function project(point, fov = 1.6) {
  const depth = -point.z;
  if (depth <= 0.01) return { x: 0, y: 0, depth, visible: false };
  return { x: (point.x * fov) / depth, y: (point.y * fov) / depth, depth, visible: true };
}

/**
 * The scene. Holds what is in the room, and steps it forward.
 *
 * Capped, because this is driven by voice and "cria um cubo" said forty
 * times should not end with a phone at four frames a second.
 */
export class Scene {
  /**
   * @param {{limit?: number, onAdd?: (item: object) => void}} [options]
   *   `onAdd` hears about every new one, whoever made it -- a sentence, the
   *   model, a hand -- which is where the interface marks its arrival.
   */
  constructor({ limit = 24, onAdd = null } = {}) {
    this.items = [];
    this.limit = limit;
    this.time = 0;
    this.onAdd = onAdd;
  }

  /** Put one in the room. Returns it. */
  add(options = {}) {
    const item = hologram(options);
    item.born = this.time;
    this.items.push(item);
    // Oldest out first: the one you just asked for is the one you are looking
    // at, and dropping that instead would be absurd. Counted in objects and in
    // edges, because one composed car can weigh as much as fifty cubes.
    while (this.items.length > this.limit
      || (this.items.length > 1 && this.weight() > LIMITS.scene)) this.items.shift();
    this.onAdd?.(item);
    return item;
  }

  /** Take one away. */
  remove(id) {
    const at = this.items.findIndex((item) => item.id === id);
    if (at < 0) return false;
    this.items.splice(at, 1);
    return true;
  }

  /** Empty the room. */
  clear() {
    const gone = this.items.length;
    this.items = [];
    return gone;
  }

  /** How many edges the room is drawing. */
  weight() {
    return this.items.reduce((sum, item) => sum + item.edges.length, 0);
  }

  /**
   * The newest one called `name` -- by what people call it ("carro") or by
   * its shape ("cubo"). Null when nothing answers to it.
   */
  find(name) {
    if (!name) return null;
    const wanted = String(name).toLowerCase();
    return [...this.items].reverse().find((item) => item.name === wanted || item.shape === wanted) ?? null;
  }

  /** The most recently added, which is what "ele" usually means. */
  last() {
    return this.items[this.items.length - 1] ?? null;
  }

  /** Change one that is already there. */
  update(id, changes = {}) {
    const item = this.items.find((row) => row.id === id);
    if (!item) return null;
    Object.assign(item, changes);
    // A new shape means new geometry; the position and the rest stay.
    if (changes.spec) item.shape = 'composto';
    if (changes.shape && !changes.spec) {
      item.spec = null;
      item.shape = changes.shape in BUILDERS ? changes.shape : 'cubo';
      item.name = changes.name ?? item.shape;
    }
    if (changes.shape || changes.spec || changes.detail !== undefined || changes.sides !== undefined) rebuild(item);
    return item;
  }

  /** Advance by `step` seconds. */
  frame(step) {
    // Clamped: a backgrounded tab hands back a step measured in minutes, and
    // every hologram would have spun through hundreds of turns at once.
    const dt = Math.min(0.1, Math.max(0, step || 0));
    this.time += dt;
    for (const item of this.items) {
      const axis = item.spinAxis === 'x' ? 'rx' : item.spinAxis === 'z' ? 'rz' : 'angle';
      item[axis] = ((item[axis] || 0) + item.spin * dt) % (Math.PI * 2);
    }
    return this.items;
  }

  /** Every edge to draw, as pairs of placed points. Nearest last. */
  edges() {
    const out = [];
    for (const item of this.items) {
      const placed = item.points.map((point) => place(point, item));
      for (const [a, b, hue] of item.edges) {
        // A part's own colour wins over the object's: the wheels of a red car.
        out.push({ item, a: placed[a], b: placed[b], hue: hue ?? item.hue });
      }
    }
    // Painter's order, by the midpoint's depth: far edges drawn first so near
    // ones sit on top. A wireframe has no faces to sort, so this is the whole
    // of the depth handling.
    //
    // Ascending, and the sign is easy to get backwards: forward is -z, so the
    // *further* something is the *smaller* its z. Sorting the other way put
    // the near cube underneath the far one, which on a wireframe is subtle
    // enough to look like nothing at all until two objects overlap.
    return out.sort((p, q) => (p.a.z + p.b.z) - (q.a.z + q.b.z));
  }
}
