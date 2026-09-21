# The face

The GUI is a particle field. He has no chat log and no avatar image — several
thousand dots settle into a face, and they move while he speaks.

No build step. These are plain ES modules, so the whole directory is copied
into the OpenJarvis server's `static/` and served as-is. That matters on a
phone: there is no npm, no bundler and no toolchain in the loop on Android.

| File | Role |
|---|---|
| `face.js` | The anatomy: silhouette profile, depth field, feature masks, the eye pass |
| `particles.js` | The field: slots, morphing, the spring, the renderer |
| `voice.js` | Two ways to answer "how loud is he right now?" |
| `app.js` | Wiring: settings, chat streaming, speech |
| `index.html` / `styles.css` | The shell around the canvas |

## How the face is built

It is not drawn as outlines. A dot mesh is laid over a depth field, and the
features emerge the way they do on a real face under light: ridges — brow,
nose bridge, cheekbones, lips — catch a key light from the upper left and read
bright, while cavities — eye sockets, nostrils, the seam between the lips —
fall into shadow and read as voids. `faceDepth()` is the single source of
truth, and lighting is computed from its gradient, so the anatomy and the
shading can never disagree.

Two details do most of the work:

- **The eyes get their own pass.** The face mesh is coarser than an iris, so
  the grid leaves a hole there and `sampleEye()` fills it at its own density,
  in polar coordinates, with radial striations and a specular highlight. The
  striation texture, more than the outline, is what makes an eye read as an eye
  instead of a bright spot.
- **Rows ride the surface.** Each row's vertical position is nudged by the
  depth, and the rows are staggered. A square grid reads as graph paper; this
  reads as skin.

## How it moves

Every particle owns a fixed slot index. Each shape answers "where does slot *i*
sit?", so morphing between the orb and the face is a straight interpolation of
two answers and each particle keeps its identity as the face assembles.

Motion comes from the real amplitude of the voice, not from a timer. Silence is
not a slower animation — it is zero displacement, so the field comes to an
actual stop. That is verified: after a second of silence, maximum particle
drift is exactly `0`.

While he speaks, the lips part around the seam, the halo drifts outward, and
the mesh shimmers — all scaled by the measured level.

## Where the level comes from

`voice.js` has two drivers, and the difference is worth knowing:

- **`AnalyserDriver`** measures actual audio through a Web Audio
  `AnalyserNode`. This is true synchrony: the particles move with the waveform.
  It needs an audio URL to play.
- **`SynthesisDriver`** wraps the browser's `speechSynthesis`, which
  deliberately does not expose its audio stream. There is nothing to measure,
  so the level is *modelled* from word-boundary events — a syllable-rate
  envelope that restarts on each word. It lands on the words and looks alive,
  but it is an approximation, not the waveform.

OpenJarvis has no TTS HTTP endpoint today: `text_to_speech` is an agent tool
that writes a file, and `/v1/speech/*` is transcription only. So the browser
voice is the default, and the analyser path activates the moment a server
returns audio. Adding that endpoint is the upgrade that makes the sync exact.

## Tuning

Everything worth adjusting is a named constant:

- `ParticleField({ count })` — 6500 resolves the features on a phone. It
  degrades gracefully: fewer dots means a coarser face, not a broken one.
- `LANDMARKS` in `face.js` — every feature position in one object.
- `restDrift` — motion left at silence. Zero by design.
- `hue` / `accentHue` — the cyan field and its warm minority.

Measured at 6500 particles: **60 fps** in Chromium at 412×880 with a 2× pixel
ratio.

## Tests

`node --test "tests-web/*.test.mjs"` from the package root. They do not check
that it *looks* right — only an eye does that. They check the structural facts
a retune must not silently break: that the silhouette tapers from cheekbones to
jaw to chin without discontinuities, that the nose tip is nearer than the cheek
and the cheek nearer than the eye socket, that the iris is a populated ring
around an empty centre, and that the arrays the renderer reads stay the same
length.
