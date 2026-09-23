/**
 * Handling the holograms with your fingers.
 *
 * A phone has no hand tracking -- see `ar.js` -- but it has a glass you touch,
 * and that is the hand this is built for. Four gestures, chosen because each
 * already means the same thing in every photo and map app, so none of them
 * needs explaining:
 *
 *   tap          choose one            (the nearest to your finger)
 *   drag         move it               (in the plane it is sitting in)
 *   pinch        make it bigger/smaller
 *   twist        turn it               (two fingers rotating)
 *   double tap   take it away
 *
 * Everything here is arithmetic over plain `{x, y}` points and the scene's
 * items, with no DOM: `Gestures` is fed pointer events by whoever owns the
 * canvas, and says what happened through callbacks. Which is why a gesture
 * can be tested without a finger.
 */

import { project } from './holo.js';

/** The focal length the stage draws with. Same default as `project`. */
export const FOV = 1.6;

/**
 * How far behind the origin the stage's camera stands, at least, in metres.
 *
 * The places `conjure` puts things were chosen for a room -- "à direita" is
 * 60 cm to the right, a metre ahead -- and from the origin a phone held
 * upright sees barely a metre and a quarter across at that distance, so the
 * sphere on the right was drawn half off the glass. The stage steps back at
 * least this far, and further when what is in the room needs it: see `fit`.
 * AR has no such problem: there you step back yourself.
 */
export const CAMERA_BACK = 0.4;
/** The furthest the stage will step back to fit everything. */
export const CAMERA_FAR = 4;

/**
 * How far the stage looks down on the room, in radians (about 24 degrees).
 *
 * Seen dead level, a ring lying on the floor is a flat band and a cube is a
 * square: the eye gets no depth at all from a wireframe viewed edge-on. A
 * slight view from above shows the top of everything, which is what makes
 * them read as solids.
 */
export const PITCH = 0.42;

/** The metre ahead the stage tilts around, so the centre stays centred. */
const PIVOT_Z = -1;

/**
 * The stage's camera: how far back, how far it looks down, and its view
 * matrix (column-major, as `ar.js` paints with).
 */
export function camera(back = CAMERA_BACK, pitch = PITCH) {
  const c = Math.cos(pitch);
  const s = Math.sin(pitch);
  // Tilt about the pivot, then move back: y' = c*y - s*(z+1),
  // z' = s*y + c*(z+1) - 1 - back.
  const matrix = [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, -s * -PIVOT_Z, c * -PIVOT_Z + PIVOT_Z - back, 1];
  return { back, pitch, matrix };
}

/** The default camera's matrix, for callers that only want to paint. */
export function stageView(back = CAMERA_BACK) {
  return camera(back).matrix;
}

/** A point as the stage's camera sees it. */
function seen(point, cam) {
  const m = cam.matrix;
  const { x, y, z } = point;
  return {
    x: m[0] * x + m[4] * y + m[8] * z + m[12],
    y: m[1] * x + m[5] * y + m[9] * z + m[13],
    z: m[2] * x + m[6] * y + m[10] * z + m[14],
  };
}

/**
 * The part of the screen that is free, in the painter's units (half the
 * shorter side = 1). The frame and the stage's buttons sit above, the
 * caption and the composer below, and something drawn under them cannot be
 * grabbed.
 */
function room(width, height) {
  const half = Math.min(width, height) / 2;
  return {
    x: ((width / 2 - 12) / half),
    up: Math.max(0.5, (height / 2 - 150) / half),
    down: Math.max(0.5, (height / 2 - 200) / half),
  };
}

/**
 * The nearest camera that shows every item whole.
 *
 * Checks the eight corners of each item's bounding box -- a spinning cube
 * reaches its half-diagonal, hence 0.87 of its size -- and steps back until
 * they all land inside the free part of the screen.
 */
export function fit(items, width, height, pitch = PITCH) {
  const free = room(width, height);
  for (let back = CAMERA_BACK; back < CAMERA_FAR; back += 0.1) {
    const cam = camera(back, pitch);
    const inside = items.every((item) => {
      const r = item.size * 0.87;
      for (const dx of [-r, r]) for (const dy of [-r, r]) for (const dz of [-r, r]) {
        const p = project(seen({ x: item.x + dx, y: item.y + dy, z: item.z + dz }, cam), FOV);
        if (!p.visible || Math.abs(p.x) > free.x || p.y > free.up || -p.y > free.down) return false;
      }
      return true;
    });
    if (inside) return cam;
  }
  return camera(CAMERA_FAR, pitch);
}

/** Smallest and largest an object may be made, in metres. A pinch that
 *  reaches zero would leave something nobody can grab again. */
export const SIZE_MIN = 0.05;
export const SIZE_MAX = 1.5;

/** How far a finger may wander and still be a tap, in CSS pixels. */
const TAP_SLOP = 10;
/** Two taps closer than this, in ms and pixels, are one double tap. */
const DOUBLE_MS = 320;
const DOUBLE_PX = 36;

/**
 * Where a point in camera space lands on a screen of this size.
 *
 * The same mapping `ar.js` paints with -- centre of the screen, half the
 * shorter side per unit -- so what you touch is what was drawn.
 */
export function toScreen(point, width, height, cam = camera()) {
  const p = project(seen(point, cam), FOV);
  const half = Math.min(width, height) / 2;
  return {
    x: width / 2 + p.x * half,
    y: height / 2 - p.y * half,
    depth: p.depth,
    visible: p.visible,
  };
}

/**
 * The object under a finger, or null.
 *
 * Nearest centre wins, within a radius that grows with how big the object
 * looks -- a large near cube should be easy to grab by its edge, a small far
 * one should still be grabbable at all, hence the floor.
 */
export function pick(items, x, y, width, height, cam = camera()) {
  const half = Math.min(width, height) / 2;
  let best = null;
  let bestDistance = Infinity;
  for (const item of items) {
    const centre = toScreen(item, width, height, cam);
    if (!centre.visible) continue;
    const reach = Math.max(44, ((item.size * FOV) / centre.depth) * half * 0.75);
    const distance = Math.hypot(centre.x - x, centre.y - y);
    if (distance <= reach && distance < bestDistance) {
      best = item;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * How far an object should travel for a finger that moved this many pixels.
 *
 * Inverse of the projection at the object's own depth, in the plane facing
 * the camera, so it stays exactly under the finger: a far object has to move
 * further in metres to cover the same glass. Under the tilted camera that
 * plane leans back, so a vertical drag also moves it a little in depth --
 * moving it straight up instead would bring it nearer and it would drift
 * out from under the finger.
 */
export function moveBy(item, dx, dy, width, height, cam = camera()) {
  const half = Math.min(width, height) / 2;
  const depth = Math.max(0.05, -seen(item, cam).z);
  const perPixel = depth / (FOV * half);
  const up = -dy * perPixel;
  // The camera's up, in the room: the transpose of the tilt applied to (0, up, 0).
  return {
    x: item.x + dx * perPixel,
    y: item.y + up * Math.cos(cam.pitch),
    z: item.z - up * Math.sin(cam.pitch),
  };
}

/**
 * What two fingers did between two moments: how much further apart (a ratio)
 * and how much they turned (radians; clockwise on the glass is positive,
 * because screen y points down).
 */
export function twoFinger(a0, b0, a1, b1) {
  const before = Math.hypot(b0.x - a0.x, b0.y - a0.y);
  const after = Math.hypot(b1.x - a1.x, b1.y - a1.y);
  const scale = before > 1 ? after / before : 1;
  let twist = Math.atan2(b1.y - a1.y, b1.x - a1.x) - Math.atan2(b0.y - a0.y, b0.x - a0.x);
  // Across the ±π seam atan2 jumps a whole turn; one frame of two fingers
  // never really turns more than half of one.
  if (twist > Math.PI) twist -= Math.PI * 2;
  if (twist < -Math.PI) twist += Math.PI * 2;
  return { scale, twist };
}

/** Keep a size inside what can still be touched. */
export function clampSize(size) {
  return Math.min(SIZE_MAX, Math.max(SIZE_MIN, size));
}

/**
 * The gesture reader.
 *
 * Fed `down`, `move` and `up` with `{id, x, y, t}`; reads the scene through
 * `items()` and the screen through `size()`; reports through the callbacks.
 * It changes items itself for move, pinch and twist -- those happen every
 * frame and a callback per frame would only be ceremony -- and asks for
 * select and remove, which are decisions the owner may want to narrate.
 */
export class Gestures {
  constructor({
    items = () => [],
    size = () => ({ width: 1, height: 1 }),
    view = () => camera(),
    onSelect = () => {},
    onRemove = () => {},
    onChange = () => {},
  } = {}) {
    this.items = items;
    this.size = size;
    /** The camera the stage is drawing with right now. */
    this.view = view;
    this.onSelect = onSelect;
    this.onRemove = onRemove;
    this.onChange = onChange;
    /** id -> {x, y, startX, startY, t} */
    this.fingers = new Map();
    this.selected = null;
    this.lastTap = null;
    /** Whether the current touch has moved beyond a tap. */
    this.dragged = false;
    /** What the one finger landed on. Not `selected`: a drag that starts on
     *  empty glass must not drag whatever happens to be chosen. */
    this.grip = null;
    /** Spin, stashed while held: a thing you are turning by hand should not
     *  also be turning on its own. */
    this.heldSpin = null;
  }

  _hold(item) {
    if (item && this.heldSpin === null) {
      this.heldSpin = { id: item.id, spin: item.spin };
      item.spin = 0;
    }
  }

  _release() {
    if (!this.heldSpin) return;
    const item = this.items().find((row) => row.id === this.heldSpin.id);
    if (item) item.spin = this.heldSpin.spin;
    this.heldSpin = null;
  }

  down({ id, x, y, t = 0 }) {
    this.fingers.set(id, { x, y, startX: x, startY: y, t });
    if (this.fingers.size === 1) {
      this.dragged = false;
      const { width, height } = this.size();
      const under = pick(this.items(), x, y, width, height, this.view());
      this.grip = under;
      // Touching one grabs it straight away, so a drag that starts on an
      // object moves that object without a tap to choose it first.
      if (under && under !== this.selected) {
        this.selected = under;
        this.onSelect(under);
      }
      if (under) this._hold(under);
    } else if (this.fingers.size === 2) {
      this.dragged = true;
      // Two fingers with nothing chosen act on the newest, which is what
      // "that one" means right after asking for it.
      if (!this.selected) {
        const items = this.items();
        const last = items[items.length - 1] ?? null;
        if (last) {
          this.selected = last;
          this.onSelect(last);
        }
      }
      this._hold(this.selected);
    }
  }

  move({ id, x, y }) {
    const finger = this.fingers.get(id);
    if (!finger) return;

    if (this.fingers.size === 1) {
      if (Math.hypot(x - finger.startX, y - finger.startY) > TAP_SLOP) this.dragged = true;
      const item = this.grip;
      if (item && this.dragged) {
        const { width, height } = this.size();
        Object.assign(item, moveBy(item, x - finger.x, y - finger.y, width, height, this.view()));
        this.onChange(item);
      }
      finger.x = x;
      finger.y = y;
      return;
    }

    const item = this.selected;
    if (this.fingers.size === 2 && item) {
      const [firstId, secondId] = [...this.fingers.keys()];
      const a0 = this.fingers.get(firstId);
      const b0 = this.fingers.get(secondId);
      const a1 = id === firstId ? { x, y } : a0;
      const b1 = id === secondId ? { x, y } : b0;
      const { scale, twist } = twoFinger(a0, b0, a1, b1);
      item.size = clampSize(item.size * scale);
      // Screen y points down, so a counter-clockwise twist on the glass is a
      // negative atan2 delta; turning the object the way the fingers turn
      // means subtracting it.
      item.angle = (item.angle - twist) % (Math.PI * 2);
      this.onChange(item);
    }
    finger.x = x;
    finger.y = y;
  }

  up({ id, x, y, t = 0 }) {
    const finger = this.fingers.get(id);
    this.fingers.delete(id);
    if (!finger) return;
    if (this.fingers.size > 0) return;
    this.grip = null;
    this._release();
    if (this.dragged) return;

    // A tap. Decide what it touched now, not at `down`: the scene may have
    // moved under a finger that rested for a moment.
    const { width, height } = this.size();
    const under = pick(this.items(), x ?? finger.x, y ?? finger.y, width, height, this.view());
    const previous = this.lastTap;
    this.lastTap = { x: finger.x, y: finger.y, t, id: under?.id ?? null };

    if (
      under && previous && previous.id === under.id &&
      t - previous.t <= DOUBLE_MS &&
      Math.hypot(previous.x - finger.x, previous.y - finger.y) <= DOUBLE_PX
    ) {
      this.lastTap = null;
      if (this.selected === under) this.selected = null;
      this.onRemove(under);
      return;
    }
    if (under !== this.selected) {
      this.selected = under;
      this.onSelect(under);
    }
  }

  /** A pointer the browser took away (a system gesture, a call coming in). */
  cancel({ id }) {
    this.fingers.delete(id);
    if (this.fingers.size === 0) this._release();
  }

  /** Forget a selection that is no longer in the scene. */
  prune() {
    if (this.selected && !this.items().includes(this.selected)) this.selected = null;
  }
}
