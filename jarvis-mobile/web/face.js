/**
 * A human face expressed as a point cloud.
 *
 * The face is not drawn as outlines. It is a dot mesh laid over a depth field,
 * and the features emerge the way they do on a real face under light: ridges
 * (brow, nose bridge, cheekbones, lips) catch the light and read bright, while
 * cavities (eye sockets, nostrils, the gap between the lips) fall into shadow
 * and read as voids. Nothing here is an ellipse pretending to be an eye.
 *
 * Everything is in unit space: x to the right, y **down**, the head spanning
 * roughly y in [-1, 1] and x in [-0.72, 0.72].
 */

const TAU = Math.PI * 2;

/** Smooth 0..1 ramp, used for every soft edge in the anatomy below. */
const smoothstep = (edge0, edge1, x) => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

/** Radially falling bump, 1 at the centre and 0 at `radius`. */
function bump(dx, dy, radius) {
  const d = Math.hypot(dx, dy) / radius;
  return d >= 1 ? 0 : Math.cos((d * Math.PI) / 2) ** 2;
}

/** Elongated bump — the shape most facial features actually have. */
function ridge(dx, dy, rx, ry) {
  const d = Math.hypot(dx / rx, dy / ry);
  return d >= 1 ? 0 : Math.cos((d * Math.PI) / 2) ** 2;
}

// Silhouette control points: half-width of the head at each height. A circle
// reads as a ball; the cranium/cheekbone/jaw/chin taper is what reads as a
// head seen from the front.
const PROFILE = [
  [-1.0, 0.30],
  [-0.88, 0.50],
  [-0.72, 0.62],
  [-0.5, 0.69],
  [-0.2, 0.72],
  [0.05, 0.71],
  [0.28, 0.65],
  [0.5, 0.55],
  [0.72, 0.4],
  [0.88, 0.25],
  [1.0, 0.08],
];

/**
 * Half-width of the head at height `y`.
 *
 * @param {number} y -1 at the crown, 1 at the chin.
 * @returns {number} Half-width in unit space; 0 outside the head.
 */
export function faceHalfWidth(y) {
  if (y <= PROFILE[0][0] || y >= PROFILE[PROFILE.length - 1][0]) return 0;
  for (let i = 1; i < PROFILE.length; i += 1) {
    const [y1, w1] = PROFILE[i];
    if (y <= y1) {
      const [y0, w0] = PROFILE[i - 1];
      return w0 + (w1 - w0) * smoothstep(y0, y1, y);
    }
  }
  return 0;
}

// Landmark positions, kept together so the anatomy can be retuned in one place.
export const LANDMARKS = {
  eyeY: -0.17,
  eyeX: 0.30,
  eyeHalfW: 0.17,
  eyeHalfH: 0.07,
  irisR: 0.062,
  pupilR: 0.024,
  browY: -0.34,
  noseTipY: 0.24,
  noseHalfW: 0.115,
  nostrilX: 0.072,
  nostrilY: 0.275,
  mouthY: 0.52,
  mouthHalfW: 0.235,
  chinY: 0.8,
};

/**
 * Height of the face surface at (x, y) — larger means nearer the viewer.
 *
 * A base dome carries the skull; every feature is a bump added to or carved
 * out of it. Lighting is computed from this field's gradient, so the anatomy
 * and the shading can never disagree.
 */
export function faceDepth(x, y) {
  const L = LANDMARKS;
  const halfWidth = faceHalfWidth(y);
  if (halfWidth <= 0) return 0;

  // Base: a dome that falls off towards the silhouette on both axes.
  const across = Math.min(1, Math.abs(x) / halfWidth);
  let z = 0.55 * Math.cos((across * Math.PI) / 2) * Math.cos((y * Math.PI) / 2.6);

  // Brow ridge, heavier towards the outer third of each eye.
  z += 0.13 * ridge(Math.abs(x) - 0.28, y - L.browY, 0.34, 0.1);
  // Eye sockets: carved in, which is what puts the eyes in shadow.
  z -= 0.13 * ridge(Math.abs(x) - L.eyeX, y - L.eyeY, 0.2, 0.13);
  // Eyeball: a sphere sitting back inside the socket.
  z += 0.075 * bump(Math.abs(x) - L.eyeX, y - L.eyeY, 0.12);

  // Nose: a bridge running down from between the brows, a tip, and two wings.
  z += 0.16 * ridge(x, y - 0.0, 0.055, 0.34);
  z += 0.2 * bump(x, y - L.noseTipY, 0.105);
  z += 0.1 * bump(Math.abs(x) - 0.105, y - 0.265, 0.075);
  // Nostrils, punched into the underside of the wings.
  z -= 0.14 * ridge(Math.abs(x) - L.nostrilX, y - L.nostrilY, 0.042, 0.028);

  // Cheekbones and the hollow beneath them.
  z += 0.085 * ridge(Math.abs(x) - 0.4, y - 0.03, 0.22, 0.16);
  z -= 0.045 * ridge(Math.abs(x) - 0.42, y - 0.28, 0.18, 0.13);

  // Lips: two cushions with the seam between them, plus the philtrum groove.
  z += 0.085 * ridge(x, y - (L.mouthY - 0.045), 0.2, 0.045);
  z += 0.095 * ridge(x, y - (L.mouthY + 0.055), 0.21, 0.055);
  z -= 0.05 * ridge(x, y - L.mouthY, 0.22, 0.016);
  z -= 0.03 * ridge(x, y - 0.44, 0.03, 0.05);

  // Chin, and the crease above it.
  z += 0.08 * bump(x, y - L.chinY, 0.2);
  z -= 0.035 * ridge(x, y - 0.68, 0.16, 0.035);

  return z;
}

/** Surface normal, from the depth field's gradient. */
function normalAt(x, y, eps = 0.012) {
  const dzdx = (faceDepth(x + eps, y) - faceDepth(x - eps, y)) / (2 * eps);
  const dzdy = (faceDepth(x, y + eps) - faceDepth(x, y - eps)) / (2 * eps);
  // Scale the gradient so ordinary facial slopes span a useful lighting range.
  const nx = -dzdx * 0.5;
  const ny = -dzdy * 0.5;
  const len = Math.hypot(nx, ny, 1);
  return [nx / len, ny / len, 1 / len];
}

// Key light from the upper left, the angle portraits are lit from.
const LIGHT = (() => {
  const v = [-0.45, -0.6, 0.66];
  const len = Math.hypot(...v);
  return v.map((c) => c / len);
})();

/** Roles let the animation treat the mouth and eyes differently. */
export const ROLE = { SKIN: 0, RIM: 1, EYE: 2, MOUTH: 3, HALO: 4 };

/**
 * Classify a point against the facial features.
 *
 * Returns a multiplier on brightness plus the point's role. Values below 0
 * mean "do not place a particle here at all" — that is how the pupil and the
 * lip seam stay as true voids rather than dim dots.
 */
function featureAt(x, y) {
  const L = LANDMARKS;
  const ax = Math.abs(x);

  // Eye aperture: an almond. Inside it sit the iris and pupil.
  const eyeD = Math.hypot((ax - L.eyeX) / L.eyeHalfW, (y - L.eyeY) / L.eyeHalfH);
  // Owned by sampleEye(), so the grid leaves a clean hole here.
  if (eyeD < 1) return { gain: -1, role: ROLE.EYE };
  // Lash line: a dark rim hugging the upper lid.
  if (eyeD < 1.24 && y < L.eyeY) return { gain: 0.2, role: ROLE.EYE };

  // Nostrils.
  if (Math.hypot((ax - L.nostrilX) / 0.05, (y - L.nostrilY) / 0.032) < 1) {
    return { gain: -1, role: ROLE.SKIN };
  }

  // The seam between the lips — the void that makes a mouth read as a mouth,
  // and the line speech opens.
  const mouthD = Math.hypot(x / L.mouthHalfW, (y - L.mouthY) / 0.02);
  if (mouthD < 1) return { gain: -1, role: ROLE.MOUTH };

  // Lip bodies: warmer and brighter than skin, and they move with speech.
  const lipD = Math.hypot(x / (L.mouthHalfW * 1.05), (y - L.mouthY) / 0.1);
  if (lipD < 1) return { gain: 1.2, floor: 0.45, role: ROLE.MOUTH };

  return { gain: 1, role: ROLE.SKIN };
}



/**
 * How much of the jaw's drop a point at (x, y) follows.
 *
 * The mandible hinges near the ears, so the chin swings furthest, the sides
 * travel less, and everything above the lip seam stays put. Returning a weight
 * per point lets the whole lower face open as one piece instead of the lips
 * sliding over a frozen chin.
 *
 * @returns {number} 0 for no movement, 1 for the full drop.
 */
export function jawWeight(x, y) {
  const L = LANDMARKS;
  // Nothing above the seam moves; the upper lip is handled separately.
  const vertical = smoothstep(L.mouthY - 0.01, L.mouthY + 0.1, y);
  // Hinges sit out by the ears, so travel falls off towards the sides.
  const lateral = 1 - 0.55 * smoothstep(0.18, 0.66, Math.abs(x));
  return vertical * lateral;
}


/**
 * How far inside the mouth opening a point lies, as a normalised radius.
 *
 * 0 at the centre of the mouth, 1 at the edge of a fully open one, larger
 * elsewhere. The renderer hides points below the current opening, which is
 * what turns a jaw drop into a cavity with a lip beneath it rather than a
 * stretched patch of skin.
 */
export function mouthAperture(x, y) {
  const L = LANDMARKS;
  return Math.hypot(x / (L.mouthHalfW * 0.92), (y - L.mouthY - 0.035) / 0.115);
}

/**
 * Detail points for one eye, at a density the face grid cannot reach.
 *
 * Built in polar coordinates around the iris so the striations run radially,
 * the way they do in a real iris — that texture, more than the outline, is
 * what makes an eye look like an eye rather than a bright spot.
 *
 * @param {number} side -1 for the left eye, 1 for the right.
 * @param {number} count Points to place.
 * @param {() => number} random
 * @param {Array} out Parallel arrays pushed into: [x, y, role, bright, size, accent].
 */
function sampleEye(side, count, random, out) {
  const L = LANDMARKS;
  const cx = side * L.eyeX;
  const cy = L.eyeY;
  const [px, py, pz, pr, pb, ps, pa, pj, pm] = out;

  // Almond aperture: two arcs meeting at the corners.
  const inAperture = (x, y) => {
    const u = (x - cx) / L.eyeHalfW;
    const v = (y - cy) / L.eyeHalfH;
    // |u|^2.6 gives the pointed corners an almond has and an ellipse does not.
    return Math.abs(u) ** 2.6 + v * v <= 1;
  };

  const irisPoints = Math.floor(count * 0.52);
  const scleraPoints = Math.floor(count * 0.28);
  const lashPoints = count - irisPoints - scleraPoints;

  // Iris: concentric rings of striations around the pupil.
  for (let i = 0; i < irisPoints; i += 1) {
    const t = i / irisPoints;
    const ring = L.pupilR + (L.irisR - L.pupilR) * Math.sqrt(t);
    // Golden-angle stepping spreads successive points around the ring instead
    // of stacking them into spokes.
    const angle = i * 2.399963 + side * 0.4;
    const wobble = 1 + Math.sin(angle * 9) * 0.05;
    const x = cx + Math.cos(angle) * ring * wobble;
    const y = cy + Math.sin(angle) * ring * wobble * 0.92;
    if (!inAperture(x, y)) continue;
    // Bright towards the pupil edge, softer at the limbus.
    const fade = 1 - t * 0.35;
    px.push(x); py.push(y); pz.push(0.45); pj.push(0); pm.push(9);
    pr.push(ROLE.EYE);
    pb.push(Math.min(1, 0.72 + fade * 0.3));
    ps.push(0.75 + fade * 0.9);
    pa.push(random() < 0.16 ? 1 : 0);
  }

  // A specular highlight: one small cluster off-centre, towards the key light.
  for (let i = 0; i < Math.max(4, irisPoints * 0.06); i += 1) {
    const angle = random() * Math.PI * 2;
    const r = random() * L.pupilR * 0.85;
    px.push(cx - L.irisR * 0.42 + Math.cos(angle) * r);
    py.push(cy - L.irisR * 0.42 + Math.sin(angle) * r);
    pz.push(0.5); pj.push(0); pm.push(9);
    pr.push(ROLE.EYE); pb.push(1); ps.push(1.5); pa.push(0);
  }

  // Sclera: dimmer fill in the corners the iris leaves.
  for (let i = 0; i < scleraPoints; i += 1) {
    const x = cx + (random() * 2 - 1) * L.eyeHalfW;
    const y = cy + (random() * 2 - 1) * L.eyeHalfH;
    if (!inAperture(x, y)) continue;
    if (Math.hypot(x - cx, y - cy) < L.irisR * 0.98) continue;
    px.push(x); py.push(y); pz.push(0.42); pj.push(0); pm.push(9);
    pr.push(ROLE.EYE);
    pb.push(0.42 + random() * 0.22);
    ps.push(0.5 + random() * 0.4);
    pa.push(0);
  }

  // Lash line: a dense dark-to-bright rim on the upper lid, which is what
  // gives the eye its shape from a distance.
  for (let i = 0; i < lashPoints; i += 1) {
    const t = i / lashPoints;
    const u = (t * 2 - 1) * L.eyeHalfW * 1.04;
    const lid = cy - L.eyeHalfH * Math.sqrt(Math.max(0, 1 - (u / (L.eyeHalfW * 1.04)) ** 2));
    px.push(cx + u);
    py.push(lid - 0.004 - random() * 0.012);
    pz.push(0.4); pj.push(0); pm.push(9);
    pr.push(ROLE.EYE);
    pb.push(0.55 + random() * 0.4);
    ps.push(0.7 + random() * 0.7);
    pa.push(random() < 0.1 ? 1 : 0);
  }
}

/**
 * Build the face point cloud.
 *
 * Points are laid out in rows so the mesh reads as a surface rather than as
 * noise, with each row's vertical position nudged by the depth field — that
 * bend is what sells the third dimension.
 *
 * @param {number} count Exact number of particles to return.
 * @param {number} [seed]
 */
export function sampleFace(count, seed = 11) {
  let a = (seed * 2654435761) >>> 0;
  const random = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  // Reserve a slice for the halo of loose points around the head.
  const haloCount = Math.floor(count * 0.08);
  // The eyes carry the likeness, so they get a budget out of proportion to
  // their area — the rest of the face tolerates a coarser mesh, they do not.
  const eyeCount = Math.floor(count * 0.09);
  const faceTarget = count - haloCount - eyeCount;

  // Surface area of the silhouette, to pick a spacing that lands near target.
  let area = 0;
  const dy = 0.004;
  for (let y = -1; y <= 1; y += dy) area += 2 * faceHalfWidth(y) * dy;
  // Rejected points (pupils, nostrils, lip seam) leave gaps, so aim slightly
  // dense and trim rather than finish short of a full face.
  const spacing = Math.sqrt(area / (faceTarget * 1.12));

  const px = [];
  const py = [];
  const pz = [];
  const pr = [];
  const pb = [];
  const ps = [];
  const pa = [];
  const pj = [];
  const pm = [];

  for (let y = -1; y <= 1; y += spacing) {
    const halfWidth = faceHalfWidth(y);
    if (halfWidth <= 0) continue;
    // Offset alternate rows: a square grid reads as graph paper, a staggered
    // one reads as skin.
    const rowOffset = (Math.round((y + 1) / spacing) % 2) * spacing * 0.5;
    for (let x = -halfWidth + rowOffset; x <= halfWidth; x += spacing) {
      const jitterX = (random() - 0.5) * spacing * 0.35;
      const jitterY = (random() - 0.5) * spacing * 0.35;
      const fx = x + jitterX;
      const fy = y + jitterY;
      if (Math.abs(fx) > faceHalfWidth(fy)) continue;

      const { gain, role, floor = 0 } = featureAt(fx, fy);
      if (gain < 0) continue; // a true void

      const z = faceDepth(fx, fy);
      const [nx, ny, nz] = normalAt(fx, fy);
      const lambert = Math.max(0, nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]);

      // Rim light along the silhouette, which separates the head from the void
      // behind it the way a real key-plus-rim setup does.
      const edge = smoothstep(0.82, 1, Math.abs(fx) / Math.max(halfWidth, 1e-6));
      const brightness = Math.max(
        floor,
        Math.min(1, (0.1 + lambert * 0.62) * gain + edge * 0.34),
      );

      px.push(fx);
      // Rows ride the surface: nearer points sit slightly higher on screen.
      py.push(fy - z * 0.12);
      pz.push(z);
      pj.push(jawWeight(fx, fy));
      pm.push(mouthAperture(fx, fy));
      pr.push(edge > 0.55 ? ROLE.RIM : role);
      pb.push(brightness);
      // Nearer and brighter points are larger, as they are in the reference.
      ps.push(0.42 + z * 1.25 + brightness * 0.75);
      // A minority of warm points keeps the field from looking monochrome.
      pa.push(random() < 0.07 && brightness > 0.45 ? 1 : 0);
    }
  }

  sampleEye(-1, Math.floor(eyeCount / 2), random, [px, py, pz, pr, pb, ps, pa, pj, pm]);
  sampleEye(1, Math.ceil(eyeCount / 2), random, [px, py, pz, pr, pb, ps, pa, pj, pm]);

  // Halo: loose points drifting off the silhouette.
  for (let i = 0; i < haloCount; i += 1) {
    const angle = random() * TAU;
    const radius = 1.05 + random() * 0.75;
    px.push(Math.cos(angle) * radius * 0.95);
    py.push(Math.sin(angle) * radius);
    pz.push(0);
    pj.push(0);
    pm.push(9);
    pr.push(ROLE.HALO);
    pb.push(0.18 + random() * 0.5);
    ps.push(0.4 + random() * 1.3);
    pa.push(random() < 0.3 ? 1 : 0);
  }

  // Normalise to exactly `count`: trim at random so thinning stays even, or
  // pad by duplicating with a nudge.
  while (px.length > count) {
    const i = Math.floor(random() * px.length);
    px.splice(i, 1); py.splice(i, 1); pz.splice(i, 1); pr.splice(i, 1);
    pb.splice(i, 1); ps.splice(i, 1); pa.splice(i, 1);
    pj.splice(i, 1); pm.splice(i, 1);
  }
  while (px.length < count) {
    const i = Math.floor(random() * px.length);
    px.push(px[i] + (random() - 0.5) * spacing);
    py.push(py[i] + (random() - 0.5) * spacing);
    pz.push(pz[i]); pr.push(pr[i]); pb.push(pb[i]);
    ps.push(ps[i]); pa.push(pa[i]); pj.push(pj[i]); pm.push(pm[i]);
  }

  return {
    xs: Float32Array.from(px),
    ys: Float32Array.from(py),
    zs: Float32Array.from(pz),
    roles: Uint8Array.from(pr),
    bright: Float32Array.from(pb),
    sizes: Float32Array.from(ps),
    accent: Uint8Array.from(pa),
    jaw: Float32Array.from(pj),
    aperture: Float32Array.from(pm),
  };
}
