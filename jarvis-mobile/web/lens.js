/**
 * Augmented reality through the camera, handled with your hands.
 *
 * WebXR's `immersive-ar` needs ARCore, and most phones asked about here do
 * not have it -- so "Realidade aumentada" used to answer with a reason and do
 * nothing. This mode needs only a camera: the video fills the screen, the
 * holograms are drawn over it by the same stage as always, and a hand in
 * front of the lens is read 21 points at a time and turned into gestures
 * (`handpose.js`). WebXR stays one tap away for the phones that have it:
 * that is what anchors things to the floor, which a flat video cannot.
 *
 * Touch keeps working the whole time. The model is a download, a GPU and a
 * well-lit hand away from working; a mode that only answered to hands would
 * be a black screen for anyone missing one of the three.
 */

import { explain } from './permissions.js';
import { BONES, HOLD_CREATE, HOLD_REMOVE, HandControl, read, smooth, toGlass } from './handpose.js';
import { controls, keyboard, noteName } from './synth.js';
import { moveBy, toScreen } from './hands.js';
import { LIBRARY, explainLoadFailure, loadHands } from './vision.js';

/** What each pose is called on the screen. */
export const POSE_LABELS = {
  pinca: 'pinça — segurando',
  punho: 'punho — segure para apagar',
  v: '✌️ — segure para criar',
  apontando: 'apontando',
  aberta: 'mão aberta',
  livre: 'mão',
};

/**
 * Where a hologram made "at the fingertip" goes: a metre ahead, moved in the
 * camera's plane until it sits under that point on the glass.
 */
export function placeAt(point, width, height, cam) {
  const ahead = { x: 0, y: 0, z: -1 };
  const centre = toScreen(ahead, width, height, cam);
  return { ...ahead, ...moveBy(ahead, point.x - centre.x, point.y - centre.y, width, height, cam) };
}

export class Lens {
  /**
   * @param {object} o
   * @param {HTMLElement} o.root The full-screen container.
   * @param {HTMLVideoElement} o.video
   * @param {HTMLCanvasElement} o.overlay Where the hand is drawn.
   * @param {import('./stage.js').Stage} o.stage
   * @param {import('./holo.js').Scene} o.scene
   * @param {(text: string) => void} [o.onStatus]
   * @param {(label: string) => void} [o.onPose]
   * @param {(item: object) => string} [o.onCreate] Returns what to say.
   */
  constructor({
    root, video, overlay, stage, scene,
    onStatus = () => {}, onPose = () => {}, onNote = () => {},
    onCreate = null, onRemove = null, synth = null,
    load = loadHands, nav = globalThis.navigator, win = globalThis,
  }) {
    Object.assign(this, { root, video, overlay, stage, scene, onStatus, onPose, onNote, synth, load, nav, win });
    /** The notes across the screen, when the synthesizer is on. */
    this.notes = keyboard();
    this.playing = null;
    this.stream = null;
    this.facing = 'environment';
    this.detector = null;
    this.loading = null;
    this.frameId = 0;
    this.lastVideoTime = -1;
    this.smoothed = [];
    /** What a V makes. Changed by whatever was last asked for by voice. */
    this.pending = { shape: 'cubo', hue: 195, size: 0.25 };

    const size = () => ({ width: win.innerWidth || 1, height: win.innerHeight || 1 });
    this.control = new HandControl({
      items: () => scene.items,
      size,
      view: () => stage.cam,
      onCreate: (at) => {
        const { width, height } = size();
        const item = scene.add({ ...this.pending, ...placeAt(at, width, height, stage.cam) });
        onStatus(onCreate ? onCreate(item) : `Criei ${item.shape === 'esfera' || item.shape === 'piramide' ? 'uma' : 'um'} ${item.shape}.`);
      },
      onRemove: (item) => {
        scene.remove(item.id);
        onStatus(onRemove ? onRemove(item) : `Apaguei ${item.shape === 'esfera' || item.shape === 'piramide' ? 'a' : 'o'} ${item.shape}.`);
      },
      onRest: (item) => {
        onStatus(
          `${item.shape === 'esfera' || item.shape === 'piramide' ? 'A' : 'O'} ${item.shape} pousou na sua mão. ` +
            'Levante dedos para girar mais rápido; pince para tirar.'
        );
      },
    });
  }

  get running() {
    return this.stream !== null;
  }

  get mirrored() {
    return this.facing === 'user';
  }

  /**
   * Open the camera. Returns true when it is showing.
   *
   * The hand model loads in the background: the camera is up and touch
   * works while it downloads, rather than a spinner in front of both.
   */
  async open(facing = this.facing) {
    const media = this.nav?.mediaDevices;
    if (!media?.getUserMedia) {
      this.onStatus('Este navegador não dá acesso à câmera aqui. Ela exige HTTPS.');
      return false;
    }
    let stream;
    try {
      stream = await media.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 720 } },
      });
    } catch (error) {
      this.onStatus(explain(error, 'a câmera', 'camera').note || `Não consegui abrir a câmera: ${error?.message ?? error}`);
      return false;
    }
    this._stopStream();
    this.stream = stream;
    this.facing = facing;
    this.video.srcObject = stream;
    this.video.classList.toggle('mirrored', this.mirrored);
    this.root.hidden = false;
    this.stage.pin(true);
    this._resize();
    await this.video.play().catch(() => {});
    this.lastVideoTime = -1;
    // One loop, however many times this is called: flipping the camera comes
    // back through here, and a second loop would run every detection twice.
    this.win.cancelAnimationFrame?.(this.frameId);
    this._loop();
    this._ensureDetector();
    return true;
  }

  /** Front to back, or back to front. */
  async flip() {
    return this.open(this.facing === 'user' ? 'environment' : 'user');
  }

  close() {
    this._stopStream();
    this.win.cancelAnimationFrame?.(this.frameId);
    this.frameId = 0;
    this.control.update([], Infinity);
    this.stage.holding = false;
    this.stage.hands.selected = null;
    this.stage.pin(false);
    this.root.hidden = true;
    this.overlay.getContext('2d')?.clearRect(0, 0, this.overlay.width, this.overlay.height);
  }

  _stopStream() {
    for (const track of this.stream?.getTracks?.() ?? []) track.stop();
    this.stream = null;
    if (this.video) this.video.srcObject = null;
  }

  _resize() {
    const ratio = Math.min(this.win.devicePixelRatio || 1, 2);
    this.overlay.width = Math.round((this.win.innerWidth || 1) * ratio);
    this.overlay.height = Math.round((this.win.innerHeight || 1) * ratio);
  }

  async _ensureDetector() {
    if (this.detector || this.loading) return this.loading;
    this.onStatus('Carregando o rastreamento de mãos… (~20 MB na primeira vez)');
    // A refused import and a failed download reject with the same message
    // ("Failed to fetch dynamically imported module"), and they need
    // opposite fixes: one is the backend's headers, the other the signal.
    // The browser does say which it was, just not in the error: it fires a
    // violation event naming the URL it refused.
    const doc = this.win.document;
    let refused = false;
    const noticed = (event) => {
      if (String(event.blockedURI ?? '').startsWith(LIBRARY)) refused = true;
    };
    doc?.addEventListener?.('securitypolicyviolation', noticed);
    this.loading = this.load()
      .then(({ landmarker, delegate }) => {
        this.detector = landmarker;
        this.onStatus(
          `Mãos prontas (${delegate === 'GPU' ? 'GPU' : 'CPU'}). Pinça agarra, ✌️ cria, punho apaga.`
        );
        return landmarker;
      })
      .catch((error) => {
        this.onStatus(explainLoadFailure(refused ? new Error('Content Security Policy') : error));
        return null;
      })
      .finally(() => {
        doc?.removeEventListener?.('securitypolicyviolation', noticed);
        this.loading = null;
      });
    return this.loading;
  }

  _loop() {
    this.frameId = this.win.requestAnimationFrame((time) => {
      if (!this.running) return;
      this._frame(time);
      this._loop();
    });
  }

  /** One camera frame: read the hands, act, draw. */
  _frame(time) {
    const video = this.video;
    if (!this.detector || video.readyState < 2 || !video.videoWidth) return;
    // Only new frames: the camera runs at 30 fps and the screen at 60, and
    // reading the same frame twice costs a detection and adds nothing.
    if (video.currentTime === this.lastVideoTime) return;
    this.lastVideoTime = video.currentTime;

    let result;
    try {
      result = this.detector.detectForVideo(video, time);
    } catch {
      return;
    }
    const frame = { width: video.videoWidth, height: video.videoHeight };
    const screen = { width: this.win.innerWidth || 1, height: this.win.innerHeight || 1 };
    const hands = (result?.landmarks ?? []).map((points, i) => {
      const glass = points.map((p) => toGlass(p, frame, screen, this.mirrored));
      this.smoothed[i] = smooth(this.smoothed[i], glass);
      return this.smoothed[i];
    });
    this.smoothed.length = hands.length;

    const reading = this.control.update(hands, time);
    this.stage.holding = Boolean(this.control.held || this.control.resting);
    this.stage.hands.selected = this.control.held ?? this.control.resting ?? this.control.hover ?? null;
    this.onPose(reading ? (this.control.resting ? 'na palma' : POSE_LABELS[reading.pose] ?? '') : '');
    this.play(reading, hands, screen);
    this.draw(hands, reading, time);
  }

  /**
   * The synthesizer's turn: what the hands mean as sound, and the room
   * answering it -- every hologram swells with the level.
   */
  play(reading, hands, screen) {
    if (!this.synth?.running) {
      this.playing = null;
      return;
    }
    const second = hands[1] ? read(hands[1]) : null;
    const shape = (this.control.held ?? this.control.resting ?? this.control.hover)?.shape ?? null;
    const sound = controls(reading, screen, { second, shape, notes: this.notes });
    this.synth.set(sound);
    this.playing = sound.gain > 0 ? sound.midi : null;
    this.onNote(this.playing === null ? '' : `♪ ${sound.note}`);
    const level = this.synth.level();
    for (const item of this.scene.items) item.pulse = level * 0.5;
  }

  /** Stop the swelling once the sound is off, so nothing stays inflated. */
  quiet() {
    this.playing = null;
    for (const item of this.scene.items) item.pulse = 0;
    this.onNote('');
  }

  /** The hand, as the annotated photo drew it: one colour per finger. */
  draw(hands, reading, time = 0) {
    const context = this.overlay.getContext('2d');
    if (!context) return;
    const ratio = this.overlay.width / (this.win.innerWidth || 1);
    context.clearRect(0, 0, this.overlay.width, this.overlay.height);
    context.lineCap = 'round';
    if (this.synth?.running) this._keys(context, ratio);
    for (const points of hands) {
      context.lineWidth = 3 * ratio;
      for (const bone of BONES) {
        const a = points[bone.from];
        const b = points[bone.to];
        context.strokeStyle = bone.colour;
        context.beginPath();
        context.moveTo(a.x * ratio, a.y * ratio);
        context.lineTo(b.x * ratio, b.y * ratio);
        context.stroke();
      }
      context.fillStyle = '#ffffff';
      for (const p of points) {
        context.beginPath();
        context.arc(p.x * ratio, p.y * ratio, 3 * ratio, 0, Math.PI * 2);
        context.fill();
      }
    }
    if (!reading) return;

    // The cursor: where the hand acts. Filled while pinching; for the two
    // held poses, an arc that fills up as the hold runs, so it is obvious
    // that something is about to happen -- and how long is left to stop it.
    const { x, y } = reading.at;
    const radius = 20 * ratio;
    context.lineWidth = 2.5 * ratio;
    context.strokeStyle = reading.pose === 'punho' ? '#fb7185' : reading.pose === 'v' ? '#4ade80' : '#7dd3fc';
    context.beginPath();
    context.arc(x * ratio, y * ratio, radius, 0, Math.PI * 2);
    if (reading.pinched) {
      context.fillStyle = 'rgba(125, 211, 252, 0.35)';
      context.fill();
    }
    context.stroke();
    const hold = reading.pose === 'punho' ? HOLD_REMOVE : reading.pose === 'v' ? HOLD_CREATE : 0;
    if (hold && !this.control.pose.fired && !this.control.resting) {
      const done = Math.min(1, (time - this.control.pose.since) / hold);
      context.lineWidth = 5 * ratio;
      context.beginPath();
      context.arc(x * ratio, y * ratio, radius + 7 * ratio, -Math.PI / 2, -Math.PI / 2 + done * Math.PI * 2);
      context.stroke();
    }
  }

  /**
   * The keyboard, drawn on the room: a faint line between notes and each
   * note's name along the bottom, the one being played lit. A theremin
   * without markings is nearly impossible to play; this is the markings.
   */
  _keys(context, ratio) {
    const width = this.win.innerWidth || 1;
    const height = this.win.innerHeight || 1;
    const key = width / this.notes.length;
    const baseline = (height - 150) * ratio;
    context.save();
    context.font = `${11 * ratio}px system-ui, sans-serif`;
    context.textAlign = 'center';
    for (const [i, midi] of this.notes.entries()) {
      const left = i * key;
      const on = midi === this.playing;
      if (on) {
        context.fillStyle = 'rgba(125, 211, 252, 0.16)';
        context.fillRect(left * ratio, 0, key * ratio, height * ratio);
      }
      if (i > 0) {
        context.strokeStyle = 'rgba(255, 255, 255, 0.12)';
        context.lineWidth = 1 * ratio;
        context.beginPath();
        context.moveTo(left * ratio, 0);
        context.lineTo(left * ratio, height * ratio);
        context.stroke();
      }
      context.fillStyle = on ? '#7dd3fc' : 'rgba(255, 255, 255, 0.55)';
      context.fillText(noteName(midi).split(' ')[0], (left + key / 2) * ratio, baseline);
    }
    context.restore();
  }
}
