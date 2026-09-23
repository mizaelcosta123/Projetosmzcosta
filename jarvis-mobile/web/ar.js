/**
 * Putting the holograms in the room.
 *
 * WebXR's `immersive-ar`, which on an Android phone means the camera behind
 * a transparent canvas and the pose of the phone handed to you every frame.
 * The drawing is 2D canvas over that, not WebGL: a few hundred lines is well
 * within a phone's budget, and it keeps the wireframes looking like the
 * particle field rather than like a different program.
 *
 * Two honest limits, both about hands.
 *
 * WebXR hand tracking (`hand-tracking`) exists, and on a headset it is how
 * this should be driven. **A phone has no hand tracking** -- there is one
 * camera and it is pointed away from you -- so on the device this app is for,
 * `hands` will simply be absent. What a phone does have is where it is
 * pointing, so the gesture that works is the one built here: aim and tap,
 * with the reticle showing what the floor hit-test found. Pretending
 * otherwise would be a button that never works. Outside a session the glass
 * itself is the hand -- see `stage.js` and `hands.js`.
 *
 * And where WebXR is missing entirely -- every iPhone browser today, and
 * Chrome without ARCore -- this says so plainly instead of failing quietly.
 */

import { Scene, project } from './holo.js';

/** What a session needs from the device. */
const FEATURES = {
  requiredFeatures: ['local'],
  optionalFeatures: ['hit-test', 'dom-overlay', 'anchors', 'hand-tracking'],
};

/** Why augmented reality is not available here, in a sentence. */
export function whyNot(nav = globalThis.navigator, secure = globalThis.isSecureContext) {
  if (secure === false) {
    return 'Realidade aumentada exige HTTPS. Abra esta página pelo endereço https.';
  }
  if (!nav?.xr) {
    return (
      'Este navegador não tem WebXR. No Android, o Chrome com os "Serviços de RA do Google" ' +
      'instalados funciona; no iPhone, nenhum navegador expõe isso ainda.'
    );
  }
  return null;
}

/** Ask the device, which is the only way to know. */
export async function supported(nav = globalThis.navigator) {
  if (whyNot(nav)) return false;
  try {
    return await nav.xr.isSessionSupported('immersive-ar');
  } catch {
    return false;
  }
}

/**
 * A running session.
 *
 * Owns the XR session, the canvas it draws on, and the scene. `onStatus` is
 * called with a sentence whenever something worth saying happens, which is
 * how the rest of the app narrates this without knowing any of it.
 */
export class Reality {
  constructor({ canvas, scene = new Scene(), onStatus = () => {}, nav = globalThis.navigator } = {}) {
    this.canvas = canvas;
    this.scene = scene;
    this.onStatus = onStatus;
    this.nav = nav;

    this.session = null;
    this.reference = null;
    this.viewer = null;
    this.hitSource = null;
    /** Where the reticle is, in world space, or null when nothing is hit. */
    this.reticle = null;
    this.lastFrame = 0;
    /** What a tap should drop. Set by whoever is listening to speech. */
    this.pending = { shape: 'cubo', hue: 195, size: 0.25 };
  }

  get running() {
    return this.session !== null;
  }

  /** Begin. Returns true when a session actually opened. */
  async start(overlay) {
    if (this.session) return true;
    const refusal = whyNot(this.nav);
    if (refusal) {
      this.onStatus(refusal);
      return false;
    }
    let session;
    try {
      session = await this.nav.xr.requestSession('immersive-ar', {
        ...FEATURES,
        ...(overlay ? { domOverlay: { root: overlay } } : {}),
      });
    } catch (error) {
      // A refusal here is usually the permission prompt being declined, and
      // it arrives as the same exception as "not supported".
      this.onStatus(
        error?.name === 'NotAllowedError'
          ? 'Você recusou a câmera para a realidade aumentada.'
          : `Não consegui abrir a realidade aumentada: ${error?.message || error}`
      );
      return false;
    }

    this.session = session;
    session.addEventListener('end', () => this._ended());
    session.addEventListener('select', () => this.drop());

    const context = this.canvas.getContext('2d');
    this.context = context;

    this.reference = await session.requestReferenceSpace('local');
    try {
      this.viewer = await session.requestReferenceSpace('viewer');
      this.hitSource = await session.requestHitTestSource?.({ space: this.viewer });
    } catch {
      // Hit testing is optional, and without it things land at a fixed
      // distance ahead instead of on the floor. Worth having, not worth
      // refusing to start over.
      this.hitSource = null;
    }

    this.onStatus(
      this.hitSource
        ? 'Aponte para uma superfície e toque para soltar o objeto.'
        : 'Sem detecção de superfície aqui — os objetos ficam à sua frente.'
    );
    session.requestAnimationFrame((time, frame) => this._frame(time, frame));
    return true;
  }

  /** End it. */
  async stop() {
    await this.session?.end().catch(() => {});
  }

  _ended() {
    this.session = null;
    this.hitSource = null;
    this.reticle = null;
    this.onStatus('Saí da realidade aumentada.');
  }

  /** Put the pending shape where the reticle is, or ahead if there is none. */
  drop() {
    const where = this.reticle ?? { x: 0, y: 0, z: -1 };
    return this.scene.add({ ...this.pending, ...where });
  }

  /** One frame of the XR loop. */
  _frame(time, frame) {
    if (!this.session) return;
    this.session.requestAnimationFrame((next, f) => this._frame(next, f));

    const step = this.lastFrame ? (time - this.lastFrame) / 1000 : 0;
    this.lastFrame = time;
    this.scene.frame(step);

    const pose = frame.getViewerPose(this.reference);
    if (!pose) return;

    if (this.hitSource) {
      const [hit] = frame.getHitTestResults(this.hitSource);
      const hitPose = hit?.getPose(this.reference);
      this.reticle = hitPose
        ? {
            x: hitPose.transform.position.x,
            y: hitPose.transform.position.y,
            z: hitPose.transform.position.z,
          }
        : null;
    }

    const view = pose.views[0];
    if (view) this.draw(view);
  }

  /**
   * Draw the scene from one eye's point of view.
   *
   * Kept separate from `_frame` and taking a plain matrix so it can be driven
   * without a headset: the maths is the part worth checking, and none of it
   * needs WebXR to run.
   */
  draw(view) {
    const context = this.context;
    if (!context) return;
    const inverse = view.transform?.inverse?.matrix ?? view.inverse;
    if (!inverse) return;
    paint(context, this.canvas.width, this.canvas.height, this.scene, inverse, {
      reticle: this.reticle,
    });
  }
}

/**
 * Draw a scene onto a 2D context, as seen through `inverse` (the camera's
 * view matrix, column-major).
 *
 * One painter for both places holograms appear -- over the camera in a
 * session, and over the field on the stage -- so they cannot drift apart.
 * `selected` is drawn brighter and heavier: something you are holding has
 * to look held.
 */
export function paint(context, width, height, scene, inverse, { reticle = null, selected = null } = {}) {
  context.clearRect(0, 0, width, height);
  const half = Math.min(width, height) / 2;

  for (const edge of scene.edges()) {
    const a = project(apply(inverse, edge.a));
    const b = project(apply(inverse, edge.b));
    if (!a.visible || !b.visible) continue;
    // Further is dimmer and thinner, which is most of what makes a
    // wireframe sit in a room instead of floating on the glass.
    const depth = (a.depth + b.depth) / 2;
    const fade = Math.max(0.08, Math.min(1, 1.6 / depth));
    const held = selected !== null && edge.item === selected;
    const light = held ? 78 : 52 + fade * 18;
    context.strokeStyle = `hsla(${edge.item.hue}, 90%, ${light}%, ${held ? 1 : fade})`;
    context.lineWidth = Math.max(0.6, fade * 2.2) * (held ? 1.8 : 1);
    context.beginPath();
    context.moveTo(width / 2 + a.x * half, height / 2 - a.y * half);
    context.lineTo(width / 2 + b.x * half, height / 2 - b.y * half);
    context.stroke();
  }

  if (reticle) {
    const spot = project(apply(inverse, reticle));
    if (spot.visible) {
      context.strokeStyle = 'rgba(125, 211, 252, 0.8)';
      context.lineWidth = 1.5;
      context.beginPath();
      context.arc(width / 2 + spot.x * half, height / 2 - spot.y * half,
                  Math.max(6, 26 / spot.depth), 0, Math.PI * 2);
      context.stroke();
    }
  }
}

/**
 * A point through a 4x4 matrix, column-major — the order WebXR uses.
 *
 * Written out rather than pulled from a library: it is twelve multiplies,
 * and a matrix library is a hundred kilobytes to a phone for this one thing.
 * Column-major means element 12, 13, 14 are the translation, which is the
 * detail that silently mirrors a scene when it is got wrong.
 */
export function apply(m, point) {
  const { x, y, z } = point;
  return {
    x: m[0] * x + m[4] * y + m[8] * z + m[12],
    y: m[1] * x + m[5] * y + m[9] * z + m[13],
    z: m[2] * x + m[6] * y + m[10] * z + m[14],
  };
}

/** The identity, for tests and for a camera at the origin looking down -z. */
export function identity() {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}
