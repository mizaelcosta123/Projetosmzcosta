/**
 * Reading a hand from its 21 points, and turning what it does into
 * something done to the holograms.
 *
 * The points are MediaPipe's hand model -- the same numbering as the
 * annotated photo this was built from:
 *
 *        8   12  16  20          tips
 *        7   11  15  19
 *    4   6   10  14  18
 *    3   5    9  13  17          knuckles (MCP)
 *     2
 *      1
 *            0                   wrist
 *
 *   polegar 1-4 · indicador 5-8 · médio 9-12 · anelar 13-16 · mínimo 17-20
 *
 * Everything here works on points already on the screen, in CSS pixels, so
 * it is plain arithmetic: `lens.js` does the camera, the model and the
 * mapping from the video to the glass, and this file never touches any of
 * them. Which is why every gesture can be tested with a hand made of numbers.
 *
 * The gestures, and why these:
 *
 *   pinça (polegar + indicador)   agarrar, e mover enquanto fechada
 *   aproximar/afastar a mão       tamanho, enquanto agarrado
 *   girar a mão                   girar, enquanto agarrado
 *   ✌️ segurado                    criar um objeto na ponta do dedo
 *   punho segurado                apagar o objeto sob a mão
 *   palma aberta sobre um objeto  ele pousa na mão e a acompanha; os dedos
 *                                 levantados (0 a 5) são a velocidade de giro
 *
 * The last one is Hand-Detection-AR's (ad8454): a cube sitting on the palm,
 * scaled by how big the hand looks, spinning as fast as the number of fingers
 * held up. That app found the palm by skin colour and a convex hull; here it
 * is simply the middle of the wrist and the middle knuckle.
 *
 * A pinch is the one gesture every hand-tracking system settles on, because
 * it is deliberate -- fingers do not touch by accident -- and it has an
 * obvious start and end. Size comes from the hand's apparent size: moving a
 * held thing towards you makes it bigger, the way it would. The two held
 * poses need a hold time, because a hand passing through a fist on its way
 * somewhere else must not delete anything.
 */

import { clampSize, moveBy, pick, toScreen } from './hands.js';

/** The finger chains, by name, in the colours of the annotated photo. */
export const FINGERS = {
  polegar: { points: [1, 2, 3, 4], colour: '#ff2bd6' },
  indicador: { points: [5, 6, 7, 8], colour: '#2b59ff' },
  medio: { points: [9, 10, 11, 12], colour: '#22e04a' },
  anelar: { points: [13, 14, 15, 16], colour: '#ffe600' },
  minimo: { points: [17, 18, 19, 20], colour: '#ff2d2d' },
};

/** Bones to draw: wrist to each finger's base, then along each finger, and
 *  across the palm between knuckles. */
export const BONES = [
  ...Object.values(FINGERS).flatMap(({ points, colour }) => [
    { from: 0, to: points[0], colour },
    ...points.slice(1).map((to, i) => ({ from: points[i], to, colour })),
  ]),
  { from: 5, to: 9, colour: '#9fb3c8' },
  { from: 9, to: 13, colour: '#9fb3c8' },
  { from: 13, to: 17, colour: '#9fb3c8' },
];

const WRIST = 0;
const THUMB_TIP = 4;
const INDEX_TIP = 8;
const MIDDLE_BASE = 9;

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/** How big the hand looks: wrist to the middle knuckle. The yardstick every
 *  other distance is divided by, so a hand near or far reads the same. */
export function handSize(points) {
  return dist(points[WRIST], points[MIDDLE_BASE]);
}

/** Which way the hand points, in radians: wrist towards the middle knuckle. */
export function handAngle(points) {
  const w = points[WRIST];
  const m = points[MIDDLE_BASE];
  return Math.atan2(m.y - w.y, m.x - w.x);
}

/**
 * Is this finger straight?
 *
 * A straight finger's tip is well beyond its middle joint as seen from the
 * wrist; a curled one folds back towards the palm, so the tip ends up no
 * further out than the joint. Measured from the wrist rather than as a
 * joint angle because it survives the hand turning towards or away from
 * the camera, which flattens angles but not this ordering.
 *
 * The thumb bends sideways, across the palm, so it is measured against the
 * little finger's knuckle instead: out means away from it.
 */
export function extended(points, name) {
  const [, joint, , tip] = FINGERS[name].points;
  if (name === 'polegar') {
    const across = points[17];
    return dist(points[tip], across) > dist(points[joint + 1], across) * 1.1 &&
      dist(points[tip], points[5]) > handSize(points) * 0.35;
  }
  const wrist = points[WRIST];
  return dist(points[tip], wrist) > dist(points[joint], wrist) * 1.15;
}

/** Thresholds, as fractions of the hand's size. Two of them for the pinch:
 *  closing needs the fingers closer than opening does, so a pinch held near
 *  the edge does not flicker open and shut every frame. */
export const PINCH_CLOSE = 0.3;
export const PINCH_OPEN = 0.45;
/** How far the index tip must stay from its own knuckle for a closed gap to
 *  count as a pinch. In a fist the thumb rests on a folded index and the two
 *  tips touch just as they do in a pinch; what differs is that a pinching
 *  index still reaches out, and a fist's is folded back to the knuckle. */
export const PINCH_REACH = 0.5;

/**
 * What one hand is doing, this frame.
 *
 * @param {{x:number,y:number}[]} points 21 points, on the screen.
 * @param {{pinched?: boolean}} [previous] Last frame's reading, for the
 *   pinch's hysteresis.
 */
export function read(points, previous = {}) {
  const size = handSize(points) || 1;
  const gap = dist(points[THUMB_TIP], points[INDEX_TIP]) / size;
  const reach = dist(points[INDEX_TIP], points[5]) / size;
  const pinched = reach > PINCH_REACH && (previous.pinched ? gap < PINCH_OPEN : gap < PINCH_CLOSE);
  const up = Object.fromEntries(Object.keys(FINGERS).map((name) => [name, extended(points, name)]));
  const fingers = ['indicador', 'medio', 'anelar', 'minimo'];
  const count = fingers.filter((name) => up[name]).length;

  let pose = 'livre';
  if (pinched) pose = 'pinca';
  else if (count === 0) pose = 'punho';
  else if (up.indicador && up.medio && !up.anelar && !up.minimo) pose = 'v';
  else if (up.indicador && count === 1) pose = 'apontando';
  else if (count === 4 && up.polegar) pose = 'aberta';

  // Where the hand is "at": between the pinching fingers when pinched, the
  // index tip when pointing or making a V, the palm's middle otherwise.
  let at;
  if (pose === 'pinca') at = mid(points[THUMB_TIP], points[INDEX_TIP]);
  else if (pose === 'v' || pose === 'apontando') at = { ...points[INDEX_TIP] };
  else at = mid(points[WRIST], points[MIDDLE_BASE]);

  const palm = mid(points[WRIST], points[MIDDLE_BASE]);
  return { pose, pinched, at, palm, size, angle: handAngle(points), gap, up };
}

/**
 * Where a video frame's point lands on the glass.
 *
 * The video fills the screen with `object-fit: cover`: scaled until both
 * sides are covered, then centred and cropped. Landmarks come normalised to
 * the *frame*, so they go through the same scale and offset. A front camera
 * is drawn mirrored -- people expect a mirror -- and its points must be too,
 * or the hand you see and the hand that acts are opposite.
 */
export function toGlass(landmark, frame, screen, mirrored = false) {
  const scale = Math.max(screen.width / frame.width, screen.height / frame.height);
  const width = frame.width * scale;
  const height = frame.height * scale;
  const left = (screen.width - width) / 2;
  const top = (screen.height - height) / 2;
  const x = mirrored ? 1 - landmark.x : landmark.x;
  return { x: left + x * width, y: top + landmark.y * height };
}

/** How long a held pose must last before it acts, in ms. */
export const HOLD_CREATE = 800;
export const HOLD_REMOVE = 700;
/** How long an open palm must rest over an object to pick it up. */
export const HOLD_REST = 600;
/** Spin per finger held up while an object rests on the palm, rad/s. */
export const SPIN_PER_FINGER = 0.7;
/** A hand missing for longer than this has let go. */
export const LOST_AFTER = 350;

/**
 * The hand as a controller for the scene.
 *
 * Fed one frame at a time with every hand on the glass; reads the scene and
 * the stage's camera through callbacks, the same way `Gestures` does, and
 * changes items directly -- a grab moves something every frame. Creating and
 * removing go through `onCreate` / `onRemove`, which the owner narrates.
 *
 * One hand drives. With two in view, the one already holding something keeps
 * driving; otherwise the first. Two-handed manipulation is a real thing on a
 * headset; at arm's length from a phone, the second hand is usually the one
 * holding the phone.
 */
export class HandControl {
  constructor({
    items = () => [],
    size = () => ({ width: 1, height: 1 }),
    view,
    onCreate = () => {},
    onRemove = () => {},
    onGrab = () => {},
    onRelease = () => {},
    onRest = () => {},
  } = {}) {
    Object.assign(this, { items, size, view, onCreate, onRemove, onGrab, onRelease, onRest });
    /** What sits on the palm, and the palm's size when it got there. */
    this.resting = null;
    this.rest = null;
    this.reading = null;
    this.previous = {};
    this.held = null;
    this.grab = null;
    this.pose = { name: 'livre', since: 0, fired: false };
    this.lastSeen = -Infinity;
    /** What the hand is over, for the cursor's highlight. */
    this.hover = null;
  }

  _viewArgs() {
    const { width, height } = this.size();
    return [width, height, ...(this.view ? [this.view()] : [])];
  }

  /**
   * One frame.
   *
   * @param {Array<Array<{x:number,y:number}>>} hands Points on the glass.
   * @param {number} time In ms.
   * @returns {object|null} This frame's reading of the driving hand.
   */
  update(hands, time) {
    if (!hands?.length) {
      if (time - this.lastSeen > LOST_AFTER) {
        this._let();
        // Taking the hand away sets the object down where it is, still
        // spinning at whatever the fingers last said.
        this.resting = null;
        this.rest = null;
      }
      this.reading = null;
      this.hover = null;
      return null;
    }
    this.lastSeen = time;
    const points = hands[0];
    const reading = read(points, this.previous);
    this.previous = reading;
    this.reading = reading;
    const [width, height, cam] = this._viewArgs();
    this.hover = this.held ?? this.resting ?? pick(this.items(), reading.at.x, reading.at.y, width, height, cam);

    // The pose clock: how long the hand has been doing this.
    if (reading.pose !== this.pose.name) this.pose = { name: reading.pose, since: time, fired: false };
    const heldFor = time - this.pose.since;

    // Something on the palm: it goes where the palm goes, and the other
    // gestures are off -- counting down to zero fingers to stop the spin is
    // a fist, and must not delete the thing in your hand. A pinch takes it
    // off the palm and into the fingers.
    if (this.resting && !this.items().includes(this.resting)) {
      this.resting = null;
      this.rest = null;
    }
    if (this.resting) {
      if (!reading.pinched) {
        this._carry(reading);
        return reading;
      }
      this.resting = null;
      this.rest = null;
    }

    if (reading.pinched) {
      if (!this.held) this._take(reading);
      else this._drag(reading);
      return reading;
    }
    this._let();

    if (reading.pose === 'aberta' && heldFor >= HOLD_REST && !this.pose.fired && this.hover) {
      this.pose.fired = true;
      this.resting = this.hover;
      this.rest = { size: this.hover.size, hand: reading.size };
      this._carry(reading);
      this.onRest(this.resting);
      return reading;
    }
    if (reading.pose === 'v' && heldFor >= HOLD_CREATE && !this.pose.fired) {
      this.pose.fired = true;
      this.onCreate(reading.at);
    }
    if (reading.pose === 'punho' && heldFor >= HOLD_REMOVE && !this.pose.fired) {
      this.pose.fired = true;
      if (this.hover) this.onRemove(this.hover);
    }
    return reading;
  }

  /** Keep the resting object on the palm: under it, sized by how near the
   *  hand is, spinning by how many fingers are up. */
  _carry(reading) {
    const item = this.resting;
    const [width, height, cam] = this._viewArgs();
    const now = toScreen(item, width, height, cam);
    Object.assign(item, moveBy(item, reading.palm.x - now.x, reading.palm.y - now.y, width, height, cam));
    item.size = clampSize(this.rest.size * (reading.size / this.rest.hand));
    item.spin = Object.values(reading.up).filter(Boolean).length * SPIN_PER_FINGER;
  }

  _take(reading) {
    const [width, height, cam] = this._viewArgs();
    const item = pick(this.items(), reading.at.x, reading.at.y, width, height, cam);
    if (!item) return;
    this.held = item;
    this.grab = {
      at: { ...reading.at },
      size: reading.size,
      angle: reading.angle,
      itemSize: item.size,
      itemAngle: item.angle,
      spin: item.spin,
    };
    item.spin = 0;
    this.onGrab(item);
  }

  _drag(reading) {
    const item = this.held;
    if (!this.items().includes(item)) {
      this.held = null;
      this.grab = null;
      return;
    }
    const [width, height, cam] = this._viewArgs();
    // Move by where the pinch went since last frame, so the object stays
    // under the fingers.
    Object.assign(item, moveBy(item, reading.at.x - this.grab.at.x, reading.at.y - this.grab.at.y, width, height, cam));
    this.grab.at = { ...reading.at };
    // Size and turn are relative to the moment of the grab, not per frame,
    // so noise in one frame cannot accumulate into drift.
    item.size = clampSize(this.grab.itemSize * (reading.size / this.grab.size));
    let turn = reading.angle - this.grab.angle;
    if (turn > Math.PI) turn -= Math.PI * 2;
    if (turn < -Math.PI) turn += Math.PI * 2;
    item.angle = this.grab.itemAngle - turn;
  }

  _let() {
    if (!this.held) return;
    const item = this.held;
    if (this.grab) item.spin = this.grab.spin;
    this.held = null;
    this.grab = null;
    this.onRelease(item);
  }
}

/**
 * Smooth a hand's points over frames.
 *
 * Landmarks jitter by a few pixels frame to frame, which on a held object
 * reads as trembling. An exponential average takes that out; `amount` is how
 * much of the previous frame survives. More is steadier and laggier.
 */
export function smooth(previous, points, amount = 0.45) {
  if (!previous || previous.length !== points.length) return points.map((p) => ({ x: p.x, y: p.y }));
  return points.map((p, i) => ({
    x: previous[i].x * amount + p.x * (1 - amount),
    y: previous[i].y * amount + p.y * (1 - amount),
  }));
}
