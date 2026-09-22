# The face

The GUI is a particle field. He has no chat log and no avatar image — several
thousand dots settle into a face, and they move while he speaks.

No build step. These are plain ES modules, so the whole directory is copied
into the OpenJarvis server's `static/` and served as-is. That matters on a
phone: there is no npm, no bundler and no toolchain in the loop on Android.

| File | Role |
|---|---|
| `orb.js` | The resting form: a 3D shell with fractal turbulence |
| `face.js` | The anatomy: silhouette profile, depth field, feature masks, the eye pass, jaw and aperture |
| `particles.js` | The field: slots, morphing, the spring, the renderer |
| `voice.js` | Two ways to answer "how loud is he right now?" |
| `app.js` | Wiring: settings, chat streaming, speech, the agent's mode switch |
| `index.html` / `styles.css` | The frame around the canvas |

## The frame

He is the interface, so the chrome recedes. Two dim icons at the top, a
hairline composer that brightens on focus, and a caption that floats over the
field on a mask rather than inside a panel. The send control has no contrast
until there is something to send, so an empty composer is just a line.

There is no status banner. The field already says what he is doing, and a
label repeating it in the centre of the screen competed with his face for the
one thing the screen is for. The `role="status"` line is still there and still
announced — it just only becomes *visible* for an error, which is the one state
the field cannot express.

## Three states, and why stillness is one of them

| State | What the field does |
|---|---|
| Idle | Nothing. Measured drift after a second of silence is exactly `0`. |
| Thinking | A slow breath, about one every three seconds, fading in and out. |
| Speaking | Driven by the measured amplitude of the voice. |

Thinking earns its own channel rather than borrowing speech's: he is not
talking, so there is no jaw drop and no cavity. Speech always wins — an answer
arriving mid-thought stops the breath instead of stacking two motions that
would read as one confused state.

Stillness being a real state is the part worth protecting. "It still looks
alive at rest" is exactly the regression a screenshot review waves through, so
`tests-web/field.test.mjs` asserts zero drift instead.

## Two forms

**The orb is the default.** He wears a face only when asked for one.

The orb is built in three dimensions and projected flat, and that is the whole
trick behind its look: points spread evenly over a sphere pile up towards the
silhouette when you flatten them, so the rim glows and the centre stays open
without a line of special-case code. Fractal noise then carves the filaments
and voids that keep it from reading as a smooth ball. A test holds the effect
in place — rim density must stay more than double the centre's.

## Asking him to change form

You ask in your own words. "Mostre seu rosto", "volte para a esfera", "show me
your face" — the model decides that `set_display_mode` is what you meant. There
is no phrase list and no keyword matching in the interface; understanding the
request is the model's job, and it gets better at it the way it gets better at
everything else.

Delivery costs nothing extra. `ToolExecutor` already publishes
`tool_call_start` with `{tool, arguments}`, and the server already forwards
agent events over `/v1/agents/events`, so **the tool call is the message** —
there is no second channel to keep in sync. `app.js` opens that WebSocket,
watches for the tool by name, and reads the mode straight off the event.

The chip in the corner stays as a manual override, but asking him is the
intended path.

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

While he speaks the whole mandible swings open. Each point carries a
`jawWeight` — 0 above the lip seam, most of the way at the lower lip, full at
the chin, falling off towards the hinges by the ears — so the lower face opens
as one piece instead of the lips sliding over a frozen chin. At the same time
`mouthAperture` carves the opening: points inside the growing ellipse are not
drawn at all, which turns the drop into a real cavity with a lip beneath it.
The halo drifts outward and the mesh shimmers, all scaled by the measured
level.

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

### Lip shape

Loudness alone opens the jaw, which means every sound at a given volume
produces the same mouth — "mmm" and "aah" become indistinguishable. So the
analyser also reads the spectrum and estimates lip spread from where the energy
sits: a vowel's first two formants move with the jaw and the tongue, so the
balance between the F1 band (300–1000 Hz) and the F2 band (1300–2800 Hz) tracks
whether the lips are spread or rounded. "ee" pushes F2 high while F1 stays low;
"oo" keeps both low; "ah" opens F1. Sibilance (4–8 kHz) nudges it spread.

That is a three-band heuristic, not a model of the vocal tract. The honest
comparison is [FaceFormer](https://github.com/EvelynFan/FaceFormer), which
predicts 15,069 numbers per frame — a full 3D mesh — from raw audio through
wav2vec 2.0. This costs one array read per frame and runs on a phone; it buys
the distinction that matters most and none of the rest.

`SynthesisDriver` leaves spread at neutral: it has no audio to measure, and
inventing a shape would be worse than admitting there isn't one.

The analyser path is live. The `speak` tool synthesizes a clip, writes it into
the directory the server already serves, and puts its URL in the tool-call
event the interface is already listening to — so no new route and no CORS. Two
backends sit behind it, and they exist together because they fail in opposite
situations: **brasiltts** runs MBROLA locally and works with no signal at all,
and **OpenRouter** sounds better when there is signal and a key.

Measured against a real MBROLA clip in Chromium: 290 frames, level spanning
0.000 to 1.000, 72% of frames carrying sound (the rest are the pauses between
words), and lip spread ranging −1.00 to +0.51. The mouth is following Brazilian
Portuguese vowels, not a syllable timer.

The browser voice remains the fallback for a machine with neither backend
ready.

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


## Mostrar algo a ele, e ver o que ele escreveu

O botão de **câmera** abre um visor sobre o campo; o de **clipe** abre o seletor
do sistema, que no Android também oferece a câmera. São dois porque "tirar uma
foto agora" e "mandar aquela de terça" são intenções diferentes, e o seletor
enterra a primeira.

A imagem é reduzida para 1280px no maior lado e reenviada como JPEG antes de
sair: um celular entrega 4000px, o modelo reamostra para algumas centenas de
qualquer jeito, e a diferença no fio são megabytes de base64 numa subida móvel.

**Uma imagem só chega ao modelo por um provedor direto.** O `ChatMessage` do
OpenJarvis tipa `content` como `str`, então uma lista de blocos é recusada com
422 antes de qualquer modelo ver. Quando isso acontece, a mensagem de erro diz
isso e aponta para Configurações → Onde ele pensa — um código de status não
apontaria para lugar nenhum.

Arquivos de texto são **citados dentro da mensagem** em vez de virarem blocos:
nenhum backend recusa uma string mais longa, e assim um `.csv` continua
funcionando contra um servidor que recusaria blocos.

O botão de **microfone** é segurar para ditar. Áudio cru não é opção — quase
nenhum modelo aceita, e os que aceitam não são para onde este app aponta. O
navegador já transcreve, então o ditado põe palavras no campo e o campo faz o
que sempre fez.

Quando a resposta traz um bloco `html` ou `svg`, aparece um botão para **rodar**.
Ele executa código que um modelo escreveu, na mesma tela que a chave de API, e
a segurança disso inteira é um par de atributos: o iframe recebe
`sandbox="allow-scripts"` e **não** `allow-same-origin`. Juntos, os dois
colocariam o quadro nesta origem, onde o script leria o `localStorage`. Separados,
ele roda numa origem opaca que não alcança nem o armazenamento nem o documento.
Não existe terceira opção que rode script com segurança, então isso não é uma
configuração.
