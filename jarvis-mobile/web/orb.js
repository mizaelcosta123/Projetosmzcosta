/**
 * The resting form: a turbulent shell of light.
 *
 * This is what he looks like when he is not wearing a face, and it is the
 * default — the face only appears when asked for.
 *
 * The shell is built in three dimensions and projected flat. That is the whole
 * trick behind its look: points spread evenly over a sphere pile up towards the
 * silhouette when you flatten them, so the rim glows and the centre stays open
 * without a single line of special-case code. Fractal noise then carves the
 * filaments and voids that keep it from reading as a smooth ball.
 */

const TAU = Math.PI * 2;

/** Integer hash → [0, 1). Cheap, deterministic, good enough for noise. */
function hash3(x, y, z) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const fade = (t) => t * t * (3 - 2 * t);
const lerp = (a, b, t) => a + (b - a) * t;

/** Trilinear value noise over a lattice. */
function valueNoise(x, y, z) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const tx = fade(x - xi);
  const ty = fade(y - yi);
  const tz = fade(z - zi);

  const c = (dx, dy, dz) => hash3(xi + dx, yi + dy, zi + dz);
  const x00 = lerp(c(0, 0, 0), c(1, 0, 0), tx);
  const x10 = lerp(c(0, 1, 0), c(1, 1, 0), tx);
  const x01 = lerp(c(0, 0, 1), c(1, 0, 1), tx);
  const x11 = lerp(c(0, 1, 1), c(1, 1, 1), tx);
  return lerp(lerp(x00, x10, ty), lerp(x01, x11, ty), tz);
}

/**
 * Fractal noise: octaves at doubling frequency and halving weight.
 *
 * Three octaves is the sweet spot here — one reads as blobs, five costs build
 * time for structure finer than the dot spacing can show.
 */
function fbm(x, y, z) {
  let sum = 0;
  let amplitude = 0.5;
  let frequency = 1;
  for (let octave = 0; octave < 3; octave += 1) {
    sum += valueNoise(x * frequency, y * frequency, z * frequency) * amplitude;
    amplitude *= 0.5;
    frequency *= 2.1; // Not exactly 2: avoids the lattice aligning with itself.
  }
  return sum / 0.875; // Normalise back to roughly 0..1.
}

/**
 * Radius relative to the face's frame.
 *
 * The face fills the screen; the orb is a compact object sitting inside it. A
 * single scale drives both shapes, so the difference lives here.
 */
const ORB_RADIUS = 0.62;

/**
 * Build the orb.
 *
 * @param {number} count Exact number of particles to return.
 * @param {number} [seed]
 * @param {object} [role] Role constants, injected so this module stays
 *   independent of the face's anatomy vocabulary.
 */
export function sampleOrb(count, seed = 3, role = { RIM: 1, HALO: 4 }) {
  let a = (seed * 2654435761) >>> 0;
  const random = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const xs = new Float32Array(count);
  const ys = new Float32Array(count);
  const zs = new Float32Array(count);
  const roles = new Uint8Array(count);
  const bright = new Float32Array(count);
  const sizes = new Float32Array(count);
  const accent = new Uint8Array(count);
  const jaw = new Float32Array(count); // unused by the orb; keeps shapes swappable
  // Far outside any mouth, so the aperture never carves into the orb.
  const aperture = new Float32Array(count).fill(9);

  const haloCount = Math.floor(count * 0.06);
  let placed = 0;
  let guard = 0;

  while (placed < count - haloCount && guard < count * 60) {
    guard += 1;

    // Even coverage of a sphere needs z uniform and the angle uniform —
    // sampling two angles instead would crowd the poles.
    const z = random() * 2 - 1;
    const ring = Math.sqrt(1 - z * z);
    const angle = random() * TAU;
    const nx = Math.cos(angle) * ring;
    const ny = Math.sin(angle) * ring;
    const nz = z;

    // Turbulence, sampled on the sphere so the pattern wraps around it.
    const turbulence = fbm(nx * 2.6 + 11, ny * 2.6 + 5, nz * 2.6 + 23);
    // Carve voids: below the threshold the shell simply is not there, which is
    // what produces filaments rather than an even fog.
    if (turbulence < 0.28 && random() > 0.2) continue;

    // Thickness varies with the same field, so dense regions look deeper.
    const shell = (0.9 + turbulence * 0.16 + (random() - 0.5) * 0.07) * ORB_RADIUS;

    xs[placed] = nx * shell;
    ys[placed] = ny * shell;
    zs[placed] = nz * shell;
    roles[placed] = role.RIM;

    // Facing away from the viewer reads dimmer, and the limb — where the
    // surface turns edge-on — reads brightest. That is the glow at the rim.
    const facing = (nz + 1) / 2;
    const limb = 1 - Math.abs(nz);
    bright[placed] = Math.min(
      1,
      0.46 + limb * 0.5 + facing * 0.22 + (turbulence - 0.5) * 0.34,
    );
    // Nearer points are larger, which separates front from back.
    sizes[placed] = 0.75 + facing * 0.95 + turbulence * 0.55;
    accent[placed] = random() < 0.04 ? 1 : 0;
    placed += 1;
  }

  // Sparks drifting off the shell.
  for (let i = placed; i < count; i += 1) {
    const z = random() * 2 - 1;
    const ring = Math.sqrt(1 - z * z);
    const angle = random() * TAU;
    const radius = (1.16 + random() * 0.75) * ORB_RADIUS;
    xs[i] = Math.cos(angle) * ring * radius;
    ys[i] = Math.sin(angle) * ring * radius;
    zs[i] = z * radius;
    roles[i] = role.HALO;
    bright[i] = 0.2 + random() * 0.55;
    sizes[i] = 0.35 + random() * 0.9;
    accent[i] = random() < 0.22 ? 1 : 0;
  }

  return { xs, ys, zs, roles, bright, sizes, accent, jaw, aperture };
}
