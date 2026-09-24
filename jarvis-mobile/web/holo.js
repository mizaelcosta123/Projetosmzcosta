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

/** The shapes he knows how to make. */
export const SOLIDS = ['cubo', 'esfera', 'piramide', 'toro', 'plano', 'eixo'];

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
function sphere({ rings = 6, segments = 12 } = {}) {
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
function torus({ around = 12, through = 6, thickness = 0.18 } = {}) {
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
function plane({ steps = 6 } = {}) {
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

const BUILDERS = {
  cubo: cube,
  esfera: sphere,
  piramide: pyramid,
  toro: torus,
  plano: plane,
  eixo: axes,
};

/**
 * Build one, by name.
 *
 * An unknown name is a cube rather than an error: this is driven by speech,
 * and a request for a "dodecaedro" should put *something* in the room while
 * he says he does not know that one.
 */
export function solid(name, options) {
  const build = BUILDERS[name] ?? BUILDERS.cubo;
  const { points, edges } = build(options);
  return { name: name in BUILDERS ? name : 'cubo', points, edges };
}

/** A thing in the room. Position in metres, scale in metres, spin in rad/s. */
export function hologram({
  shape = 'cubo', x = 0, y = 0, z = -1, size = 0.25, hue = 195,
  spin = 0.4, id = '', label = '',
} = {}) {
  return {
    id: id || `h${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    shape, x, y, z, size, hue, spin, label,
    born: 0, angle: 0,
    ...solid(shape),
  };
}

/**
 * Rotate a point about Y, then move it. The order matters and is the usual
 * one: spin the object on its own axis, then put it where it goes.
 */
export function place(point, item) {
  const c = Math.cos(item.angle);
  const s = Math.sin(item.angle);
  // `pulse` swells it with the synthesizer's level (lens.js); zero otherwise.
  const size = item.size * (1 + (item.pulse || 0));
  const x = point.x * size;
  const y = point.y * size;
  const z = point.z * size;
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
    // at, and dropping that instead would be absurd.
    while (this.items.length > this.limit) this.items.shift();
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
    if (changes.shape) Object.assign(item, solid(changes.shape));
    return item;
  }

  /** Advance by `step` seconds. */
  frame(step) {
    // Clamped: a backgrounded tab hands back a step measured in minutes, and
    // every hologram would have spun through hundreds of turns at once.
    const dt = Math.min(0.1, Math.max(0, step || 0));
    this.time += dt;
    for (const item of this.items) {
      item.angle = (item.angle + item.spin * dt) % (Math.PI * 2);
    }
    return this.items;
  }

  /** Every edge to draw, as pairs of placed points. Nearest last. */
  edges() {
    const out = [];
    for (const item of this.items) {
      const placed = item.points.map((point) => place(point, item));
      for (const [a, b] of item.edges) {
        out.push({ item, a: placed[a], b: placed[b] });
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
