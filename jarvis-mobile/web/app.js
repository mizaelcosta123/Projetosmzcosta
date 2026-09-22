/**
 * Wires the particle field to a voice and to an OpenJarvis server.
 *
 * The field is the interface. Text is a caption under it, not a transcript —
 * the point of this GUI is that you watch him speak rather than read a log.
 */

import { ParticleField } from './particles.js';
import { AnalyserDriver, SynthesisDriver, createVoiceDriver } from './voice.js';

import { buildContent, explainRefusal, isImage, isText, toDataUrl } from './attach.js';
import { details, fetchDevice, summarize } from './device.js';
import { SANDBOX, asDocument, describe as describeRun, previewable } from './preview.js';
import { explain } from './diagnose.js';
import { LiveSession, WakeWord } from './live.js';
import {
  chatUrl,
  fetchModels,
  headersFor,
  makeProvider,
  modelsUrl,
  reachesDevice,
  termuxOllama,
} from './providers.js';

const SETTINGS_KEY = 'jarvis.settings.v1';

const el = {
  canvas: document.getElementById('field'),
  status: document.getElementById('status'),
  live: document.getElementById('live'),
  wake: document.getElementById('wake'),
  caption: document.getElementById('caption'),
  composer: document.getElementById('composer'),
  prompt: document.getElementById('prompt'),
  send: document.getElementById('send'),
  shape: document.getElementById('shape'),
  menu: document.getElementById('menu'),
  settings: document.getElementById('settings'),
  provider: document.getElementById('provider'),
  providerRole: document.getElementById('provider-role'),
  providerName: document.getElementById('provider-name'),
  providerUrl: document.getElementById('provider-url'),
  providerHint: document.getElementById('provider-hint'),
  providerKey: document.getElementById('provider-key'),
  providerTest: document.getElementById('provider-test'),
  providerRemove: document.getElementById('provider-remove'),
  providerAdd: document.getElementById('provider-add'),
  providerOllama: document.getElementById('provider-ollama'),
  providerStatus: document.getElementById('provider-status'),
  camera: document.getElementById('camera'),
  attach: document.getElementById('attach'),
  file: document.getElementById('file'),
  record: document.getElementById('record'),
  tray: document.getElementById('tray'),
  viewfinder: document.getElementById('viewfinder'),
  preview: document.getElementById('preview'),
  shoot: document.getElementById('shoot'),
  flip: document.getElementById('flip'),
  closeCamera: document.getElementById('close-camera'),
  run: document.getElementById('run'),
  stage: document.getElementById('stage'),
  frame: document.getElementById('frame'),
  closeStage: document.getElementById('close-stage'),
  deviceState: document.getElementById('device-state'),
  deviceDetail: document.getElementById('device-detail'),
  deviceRefresh: document.getElementById('device-refresh'),
  model: document.getElementById('model'),
  speak: document.getElementById('speak'),
  voiceMode: document.getElementById('voice-mode'),
  modelOptions: document.getElementById('model-options'),
  modelHint: document.getElementById('model-hint'),
  demoBtn: document.getElementById('demo-btn'),
};

// -- settings ---------------------------------------------------------------

/**
 * Load saved settings.
 *
 * Storage can throw outright in a private window or with site data blocked, so
 * every read is guarded: a browser that refuses to remember the server URL
 * should still render the face.
 */
function loadSettings() {
  const fallback = { providers: [], active: '', model: '', speak: true, wake: true };
  let saved = fallback;
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    saved = raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
  return migrate(saved);
}

/**
 * Bring a settings object up to the current shape.
 *
 * This app shipped with a single `serverUrl`/`apiKey` pair before it could
 * hold a list. Somebody who set that up once and has been using it since must
 * not open the sheet one day and find it blank, so the old pair becomes the
 * first entry in the list and stays selected.
 */
function migrate(saved) {
  if (Array.isArray(saved.providers) && saved.providers.length > 0) return saved;

  const providers = [];
  if (saved.serverUrl || saved.apiKey) {
    providers.push(makeProvider({ url: saved.serverUrl ?? '', key: saved.apiKey ?? '' }));
  } else {
    // No entry at all means "this same page", which is the right default when
    // the backend is what served it.
    providers.push(makeProvider({ name: 'Este servidor', url: '' }));
  }
  return {
    providers,
    active: providers[0].id,
    model: saved.model ?? '',
    speak: saved.speak ?? true,
    wake: saved.wake ?? true,
  };
}

function saveSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* Not fatal — the session simply will not be remembered. */
  }
}

let settings = loadSettings();

/** The entry currently in use, never undefined: a missing id falls back. */
function activeProvider() {
  return (
    settings.providers.find((entry) => entry.id === settings.active) ??
    settings.providers[0] ??
    makeProvider({ url: '' })
  );
}

/** @type {LiveSession|null} The open session, or null when nothing listens.
 *
 * Declared here, above say(), which reads it: a `let` further down would be in
 * the temporal dead zone for any earlier caller. */
let live = null;

/** @type {WakeWord|null} Listens for his name while nothing else listens. */
let wake = null;

/** What is riding along with the next message.
 *
 * Up here for the same reason as the two above: streamReply reads it, and a
 * `let` further down would be in the temporal dead zone for any earlier
 * caller.
 *
 * @type {{id: string, kind: string, dataUrl?: string, text?: string, name: string}[]}
 */
let attached = [];

// Served from the OpenJarvis server itself? Then it is the default target and
// no one has to type a URL.
const sameOrigin = location.protocol.startsWith('http') ? location.origin : '';
const serverOf = (s) => {
  const entry =
    s.providers?.find((row) => row.id === s.active) ?? s.providers?.[0] ?? null;
  return (entry?.url || sameOrigin).replace(/\/+$/, '');
};

// -- the field --------------------------------------------------------------

// 6500 resolves the face's features on a phone screen. Drop it if a weak
// device drops frames — the anatomy degrades gracefully, it does not break.
const field = new ParticleField(el.canvas, { count: 6500, shape: 'orb' });
field.start();

// Debounced through rAF: orientation changes fire resize in bursts, and the
// canvas reallocation is the expensive part.
let resizePending = false;
window.addEventListener('resize', () => {
  if (resizePending) return;
  resizePending = true;
  requestAnimationFrame(() => {
    resizePending = false;
    field.resize();
  });
});

// -- voice ------------------------------------------------------------------

// No TTS endpoint exists upstream yet, so the browser voice is the default and
// the analyser path activates the moment a server returns audio. See README.
let voice = createVoiceDriver(false);

function describeVoice() {
  if (voice instanceof AnalyserDriver) {
    return 'Áudio do servidor: as partículas seguem a forma de onda real.';
  }
  if (voice instanceof SynthesisDriver) {
    return 'Voz do navegador: o ritmo acompanha as palavras, mas a amplitude é estimada — o navegador não expõe o áudio.';
  }
  return 'Sem voz disponível neste navegador; o campo fica em repouso.';
}

/** Pump the measured level into the field every frame while speech lasts. */
function followVoice() {
  if (!voice.speaking) {
    field.setLevel(0);
    return;
  }
  // sample() returns loudness and leaves the lip shape on the driver; passing
  // both is what lets the mouth tell one vowel from another.
  field.setLevel(voice.sample(), voice.spread);
  requestAnimationFrame(followVoice);
}

voice.addEventListener('start', () => {
  setStatus('falando', 'speaking');
  followVoice();
});
voice.addEventListener('end', () => {
  field.setLevel(0);
  setStatus('em repouso');
});

/**
 * Say something aloud, if speech is enabled.
 *
 * @param {string} text
 * @param {string} [audioUrl] Server-rendered audio; enables real analysis.
 */
async function say(text, audioUrl) {
  if (!settings.speak) return;
  if (!audioUrl && !text.trim()) return;
  // While he talks, the live session needs a way to duck him and a way to cut
  // him off. It holds this until the sentence ends.
  const handle = {
    pause: () => voice.stop(),
    setVolume: (volume) => voice.setVolume(volume),
  };
  if (live?.active) live.speakingStarted(handle);

  try {
    if (audioUrl) {
      // Real audio: the analyser measures it, so the mouth is in sync rather
      // than approximately in step.
      if (!(voice instanceof AnalyserDriver)) voice = adoptDriver(new AnalyserDriver());
      await voice.speak(audioUrl);
    } else if (voice instanceof SynthesisDriver) {
      await voice.speak(text);
    }
  } catch (error) {
    // A failed voice must never swallow the answer — the caption already has it.
    console.warn('speech failed', error);
    field.setLevel(0);
    setStatus('em repouso');
  } finally {
    if (live?.active) live.speakingEnded();
  }
}

/** Swap drivers while keeping the field's listeners attached. */
function adoptDriver(next) {
  next.addEventListener('start', () => {
    setStatus('falando', 'speaking');
    followVoice();
  });
  next.addEventListener('end', () => {
    field.setLevel(0);
    setStatus('em repouso');
  });
  return next;
}



// -- the agent changing how he looks ---------------------------------------

/**
 * Listen for the agent switching his own appearance.
 *
 * Nothing new crosses the wire for this. `ToolExecutor` already publishes
 * `tool_call_start` with `{tool, arguments}`, and the server already forwards
 * agent events over `/v1/agents/events`, so the tool call *is* the message.
 *
 * Browsers cannot set an Authorization header on a WebSocket, so the key rides
 * in the subprotocol list — the encoding makes it valid syntax, not secret.
 */
function watchAgentEvents() {
  const base = serverOf(settings);
  if (!base) return;

  const url = base.replace(/^http/, 'ws') + '/v1/agents/events';
  const key = activeProvider().key;
  const protocols = key
    ? ['openjarvis.auth.v1', 'openjarvis.key.b64url.' + base64url(key)]
    : [];

  let socket;
  try {
    socket = protocols.length ? new WebSocket(url, protocols) : new WebSocket(url);
  } catch (error) {
    console.warn('event stream unavailable', error);
    return;
  }

  socket.addEventListener('message', (event) => {
    let payload;
    try {
      payload = JSON.parse(event.data);
    } catch {
      return;
    }
    const data = payload.data ?? {};

    if (payload.type === 'tool_call_start' && data.tool === 'set_display_mode') {
      const mode = data.arguments?.mode;
      if (mode && field.shapes[mode]) applyMode(mode);
      return;
    }

    // A finished `speak` carries the clip's URL. This is the path that makes
    // the mouth follow a measured waveform instead of a modelled envelope, so
    // it takes over from the browser voice whenever it fires.
    if (payload.type === 'tool_call_end' && data.tool === 'speak' && data.success) {
      const url = data.metadata?.audio_url;
      if (url) {
        setCaption(data.metadata.text || '');
        say('', url).catch(() => {});
      }
    }
  });

  // Reconnect with a ceiling: a phone that sleeps or changes network drops the
  // socket routinely, and a tight retry loop would drain the battery.
  socket.addEventListener('close', () => {
    reconnectDelay = Math.min(reconnectDelay * 2, 30000);
    setTimeout(watchAgentEvents, reconnectDelay);
  });
  socket.addEventListener('open', () => {
    reconnectDelay = 1000;
  });
}

let reconnectDelay = 1000;

/** Base64url without padding — what the server's subprotocol scheme expects. */
function base64url(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Switch form, keeping the manual override's icon honest. */
function applyMode(mode) {
  field.setShape(mode);
  el.shape.dataset.shape = mode;
}

// -- status and caption -----------------------------------------------------

/**
 * Announce what he is doing.
 *
 * The field already shows it — still, breathing, speaking — so this is the
 * accessible equivalent, and it becomes visible only for an error, which the
 * field has no way to express.
 */
function setStatus(text, state = '') {
  el.status.textContent = text;
  el.status.dataset.state = state;
  field.setThinking(state === 'thinking');
}

function setCaption(text) {
  el.caption.textContent = text;
  el.caption.scrollTop = el.caption.scrollHeight;
}

// -- talking to the server --------------------------------------------------


/**
 * The model to ask for.
 *
 * The server rejects a request without one — a 422, not a default — so leaving
 * the field blank in settings has to mean "whatever this server is set to",
 * not "omit it".
 *
 * `/v1/info` carries exactly that: the model the server was configured with.
 * It beats picking from `/v1/models`, which lists everything an engine can
 * reach — for an aggregator like OpenRouter that is hundreds of models, the
 * first of them is arbitrary, and the server filters provider-qualified IDs
 * out of that list anyway, so it can come back empty. The list stays as a
 * fallback for a server that reports no configured model.
 *
 * Cached for the session: it cannot change without the server restarting.
 */
let resolvedModel = '';

async function modelFor(base, headers) {
  if (settings.model) return settings.model;
  if (resolvedModel) return resolvedModel;

  const configured = await fetch(`${base}/v1/info`, { headers })
    .then((response) => (response.ok ? response.json() : null))
    .then((info) => info?.model)
    .catch(() => null);
  if (configured) {
    resolvedModel = configured;
    return configured;
  }

  const response = await fetch(`${base}/v1/models`, { headers });
  if (!response.ok) {
    throw new Error(
      `Não consegui descobrir qual modelo usar (${response.status}). ` +
        'Escolha um em Configurações → Modelo.',
    );
  }
  const first = (await response.json())?.data?.[0]?.id;
  if (!first) {
    throw new Error(
      'O servidor não disse qual modelo usar. Escolha um em Configurações → Modelo — ' +
        'com OpenRouter, algo como "anthropic/claude-sonnet-4.5".',
    );
  }
  resolvedModel = first;
  return first;
}

/**
 * Stream a chat completion.
 *
 * Uses the OpenAI-compatible endpoint OpenJarvis already serves, so this
 * client works against a plain `jarvis serve` with nothing added.
 *
 * @param {string} text
 * @param {(chunk: string) => void} onChunk Called with each delta.
 * @returns {Promise<string>} The full reply.
 */
async function streamReply(text, onChunk) {
  const base = serverOf(settings);
  if (!base) throw new Error('Nenhum servidor configurado.');

  const headers = { 'Content-Type': 'application/json' };
  Object.assign(headers, headersFor(activeProvider()));

  // A string when nothing is attached, content blocks when a picture is.
  // Reaching for blocks without a reason would break a Jarvis backend, whose
  // `content` field is typed as a string.
  const content = buildContent(text, attached);
  const carriedImage = Array.isArray(content);

  const body = {
    model: await modelFor(base, headers),
    messages: [{ role: 'user', content }],
    stream: true,
  };

  const response = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    // The likeliest refusal when a picture is riding along, and the one a
    // status code explains worst: a Jarvis backend rejects the whole message
    // before any model sees the image.
    const about = explainRefusal(response.status, carriedImage, reachesDevice(activeProvider()));
    if (about) throw new Error(about);
    const detail = await response.text().catch(() => '');
    throw new Error(`${response.status} ${response.statusText} ${detail}`.trim());
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffered = '';
  let full = '';

  // Server-sent events arrive split across arbitrary chunk boundaries, so the
  // tail of each read is held back until its newline shows up.
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffered += decoder.decode(value, { stream: true });
    const lines = buffered.split('\n');
    buffered = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      try {
        const delta = JSON.parse(payload).choices?.[0]?.delta?.content;
        if (delta) {
          full += delta;
          onChunk(delta);
        }
      } catch {
        /* Keep-alives and comments are not JSON; skipping them is correct. */
      }
    }
  }
  return full;
}

// -- interactions -----------------------------------------------------------

let busy = false;

const syncReady = () => {
  // An attachment alone is something to send, so the composer counts it too.
  const ready = el.prompt.value.trim().length > 0 || attached.length > 0;
  el.composer.dataset.ready = String(ready);
};
el.prompt.addEventListener('input', syncReady);
syncReady();

/**
 * Ask him something, from the composer or from the microphone.
 *
 * One path for both, so live voice cannot drift from typing: same streaming,
 * same captions, same errors, same voice.
 *
 * @param {string} text
 */
async function ask(text) {
  // A photo with no words is a message: "what is this?" is the question, and
  // buildContent supplies it. Only an empty field *and* an empty tray is
  // nothing to send.
  if ((!text && attached.length === 0) || busy) return;

  busy = true;
  el.send.disabled = true;
  setCaption('');
  offerPreview('');
  setStatus('pensando', 'thinking');

  try {
    let shown = '';
    const sent = attached;
    const reply = await streamReply(text, (chunk) => {
      shown += chunk;
      setCaption(shown);
    });
    // Only once it got through: a refused image should still be in the tray,
    // so fixing the setting and pressing send again is all it takes.
    if (attached === sent) {
      attached = [];
      renderTray();
    }
    offerPreview(reply);
    await say(reply);
    if (!settings.speak) setStatus('em repouso');
  } catch (error) {
    setStatus('erro', 'error');
    setCaption(explain(error, serverOf(settings)));
  } finally {
    field.setThinking(false);
    busy = false;
    el.send.disabled = false;
  }
}

el.composer.addEventListener('submit', (event) => {
  event.preventDefault();
  const text = el.prompt.value.trim();
  el.prompt.value = '';
  syncReady();
  ask(text);
});

// -- live voice -------------------------------------------------------------

/** What each session state looks like on screen. */
const LIVE_STATUS = {
  listening: 'ouvindo',
  hearing: 'ouvindo você',
  'cutting-in': 'ouvindo você',
  asking: 'pensando',
  answering: 'falando',
  off: 'em repouso',
};

function showLive(mode) {
  // Drives the button's animation: absent when off, idling when listening,
  // quickened while it has your voice.
  if (mode) el.composer.dataset.live = mode;
  else delete el.composer.dataset.live;
  el.live.setAttribute('aria-pressed', String(Boolean(mode)));
}

/**
 * Open or close a live session.
 *
 * @param {string} [first] Something already said — the words after his name,
 *   so "Jarvis, qual a bateria?" is one sentence and not two.
 */
async function toggleLive(first = '') {
  if (live?.active) {
    live.stop();
    return;
  }

  // One recogniser at a time: the wake listener has to let go of the
  // microphone before the session can take it.
  wake?.stop();

  const session = new LiveSession();
  session.addEventListener('state', (event) => {
    const { state, text } = event.detail;

    if (state === 'off') {
      live = null;
      showLive('');
      setStatus('em repouso');
      armWake(); // back to waiting for his name, if that is switched on
      return;
    }
    if (state === 'error') {
      setStatus('erro', 'error');
      setCaption(`Não consegui ouvir: ${text}`);
      return;
    }

    showLive(state === 'hearing' || state === 'cutting-in' ? 'hearing' : 'on');

    // `answering` is the voice's own business — say() already set the status
    // and the field is following the waveform. Overwriting it here would
    // flatten the one state the page shows best.
    if (state === 'answering') return;
    if (state === 'asking') return; // ask() takes it from here

    setStatus(LIVE_STATUS[state] ?? 'ouvindo');
    // Interim words, shown as they arrive: proof it is hearing you, and the
    // only feedback there is before the answer starts.
    if (text) setCaption(text);
  });

  session.addEventListener('ask', (event) => {
    ask(event.detail.text);
  });

  try {
    await session.start();
    live = session;
    showLive('on');
    if (first) ask(first);
  } catch (error) {
    // Permission refused, or a browser that cannot do it. Either way the
    // reason belongs on screen, not in the console.
    setStatus('erro', 'error');
    setCaption(String(error.message || error));
    showLive('');
  }
}

el.live.addEventListener('click', () => toggleLive());

// -- his name ---------------------------------------------------------------

/**
 * Listen for his name, if that is switched on and nothing else is listening.
 *
 * Idempotent, and called from everywhere the answer might have changed: the
 * first tap on the page, closing the settings sheet, and the end of a session.
 */
function armWake() {
  if (!settings.wake || live?.active) {
    wake?.stop();
    return;
  }
  if (!wake) {
    wake = new WakeWord();
    wake.addEventListener('wake', (event) => toggleLive(event.detail.rest));
    wake.addEventListener('denied', () => {
      // Refusing the microphone is an answer. Remember it instead of asking
      // again on every visit, and say what still works — and where to undo it,
      // because a setting that turns itself off and does not say where it
      // lives is a setting nobody finds again.
      settings = { ...settings, wake: false };
      saveSettings(settings);
      el.wake.checked = false;
      setStatus('erro', 'error');
      setCaption(
        'Sem permissão para o microfone, então desliguei o atendimento pelo nome. ' +
          'O botão de ondas continua funcionando, e você pode religar em ' +
          'Configurações → Atender pelo nome.'
      );
    });
    wake.addEventListener('unavailable', () => {
      // Not a refusal: the transcription service could not be reached, and
      // nobody was asked anything. It comes back on its own, so the setting
      // stays on and the recogniser keeps retrying — saying "sem permissão"
      // here would be a lie that also switches the feature off for good.
      if (unavailableSaid) return;
      unavailableSaid = true;
      setCaption(
        'O serviço de transcrição não respondeu agora — continuo tentando. ' +
          'O botão de ondas funciona normalmente.'
      );
    });
  }
  try {
    wake.start();
  } catch {
    // A browser without speech recognition. The button says so when pressed;
    // there is nothing useful to announce before anyone asks.
  }
}

/** Said once per visit: a service outage repeats, and so would the caption. */
let unavailableSaid = false;

// A page cannot open a microphone before the person has touched it, so a touch
// has to come first — but not *any* touch. Arming on the first pointerdown
// anywhere put a permission prompt in front of someone who had just tapped the
// settings gear, with nothing on screen explaining why, and dismissing that
// prompt used to switch the feature off permanently. The composer is where
// talking to him starts, so that is where the microphone may be asked for.
el.prompt.addEventListener('focus', armWake, { once: true });
el.live.addEventListener('pointerdown', armWake, { once: true });
el.canvas.addEventListener('pointerdown', armWake, { once: true });

// The toggle stays as a manual override; asking him is the intended path.
el.shape.addEventListener('click', () => {
  applyMode(field.targetShape === 'face' ? 'orb' : 'face');
});

// -- running what he wrote ---------------------------------------------------

/** @type {{language: string, code: string}|null} The block the button would run. */
let runnable = null;

/** Offer a preview when the reply carries a page, and withdraw it when not. */
function offerPreview(reply) {
  runnable = previewable(reply);
  el.run.hidden = runnable === null;
  el.run.textContent = describeRun(runnable);
}

el.run.addEventListener('click', () => {
  if (!runnable) return;
  // Set here rather than in the markup so it comes from the same constant the
  // tests assert on. allow-scripts without allow-same-origin: the frame runs
  // the code and cannot read this origin's localStorage, where the key lives.
  el.frame.setAttribute('sandbox', SANDBOX);
  el.frame.srcdoc = asDocument(runnable);
  el.stage.hidden = false;
});

el.closeStage.addEventListener('click', () => {
  el.stage.hidden = true;
  el.frame.srcdoc = ''; // stop whatever it was doing
});

// -- what goes along with the message ---------------------------------------

/** Redraw the tray. Hidden when empty, so the composer never moves. */
function renderTray() {
  el.tray.hidden = attached.length === 0;
  syncReady();
  el.tray.replaceChildren(
    ...attached.map((item) => {
      const figure = document.createElement('figure');
      if (item.kind === 'image') {
        const image = document.createElement('img');
        image.src = item.dataUrl;
        image.alt = item.name;
        figure.append(image);
      } else {
        const box = document.createElement('span');
        box.className = 'doc';
        box.textContent = item.name;
        figure.append(box);
      }
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = '×';
      remove.setAttribute('aria-label', `Remover ${item.name}`);
      remove.addEventListener('click', () => {
        attached = attached.filter((row) => row.id !== item.id);
        renderTray();
      });
      figure.append(remove);
      return figure;
    })
  );
}

/** Add a file the person picked, or a frame the camera took. */
async function addFile(file) {
  const name = file.name || 'imagem.jpg';
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  try {
    if (isImage(file.type)) {
      attached.push({ id, kind: 'image', name, dataUrl: await toDataUrl(file) });
    } else if (isText(file.type, name)) {
      attached.push({ id, kind: 'text', name, text: await file.text() });
    } else {
      setCaption(`Não sei o que fazer com ${name}. Mande uma imagem ou um texto.`);
      return;
    }
  } catch (error) {
    setCaption(`Não consegui ler ${name}: ${error.message || error}`);
    return;
  }
  renderTray();
}

el.attach.addEventListener('click', () => el.file.click());
el.file.addEventListener('change', async () => {
  for (const file of el.file.files) await addFile(file);
  el.file.value = ''; // so picking the same file twice still fires
});

// -- the camera ---------------------------------------------------------------

let stream = null;
let facing = 'environment'; // the back camera is what you point at things

async function openCamera() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: facing },
      audio: false,
    });
  } catch (error) {
    setStatus('erro', 'error');
    setCaption(
      error?.name === 'NotAllowedError'
        ? 'Sem permissão para a câmera. Libere nas configurações do navegador.'
        : `Não consegui abrir a câmera: ${error.message || error}`
    );
    return;
  }
  el.preview.srcObject = stream;
  el.viewfinder.hidden = false;
  el.camera.dataset.on = 'yes';
}

function closeCamera() {
  // Every track, explicitly: dropping the reference leaves the camera light on.
  stream?.getTracks().forEach((track) => track.stop());
  stream = null;
  el.preview.srcObject = null;
  el.viewfinder.hidden = true;
  el.camera.dataset.on = '';
}

el.camera.addEventListener('click', () => (stream ? closeCamera() : openCamera()));
el.closeCamera.addEventListener('click', closeCamera);

el.flip.addEventListener('click', async () => {
  facing = facing === 'environment' ? 'user' : 'environment';
  closeCamera();
  await openCamera();
});

el.shoot.addEventListener('click', async () => {
  const video = el.preview;
  if (!video.videoWidth) return; // the first frame has not arrived yet

  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
  closeCamera();
  if (blob) await addFile(new File([blob], 'camera.jpg', { type: 'image/jpeg' }));
  el.prompt.focus();
});

// -- holding the button to dictate --------------------------------------------

/** @type {any} The dictation recogniser, separate from the live session's. */
let dictation = null;

function startDictation() {
  const Recognition = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
  if (!Recognition) {
    setCaption('Este navegador não transcreve fala.');
    return;
  }
  if (dictation) return;

  // Raw audio is not an option: almost no model takes it, and the ones that do
  // are not what this app points at. The browser already transcribes, so this
  // puts words in the field and the field does what it always did.
  dictation = new Recognition();
  dictation.lang = 'pt-BR';
  dictation.interimResults = true;
  const before = el.prompt.value;

  dictation.onresult = (event) => {
    let heard = '';
    for (let index = 0; index < event.results.length; index += 1) {
      heard += event.results[index][0]?.transcript ?? '';
    }
    el.prompt.value = before ? `${before} ${heard}` : heard;
  };
  dictation.onerror = (event) => {
    if (event.error === 'not-allowed') setCaption('Sem permissão para o microfone.');
  };
  dictation.onend = () => {
    dictation = null;
    el.record.dataset.on = '';
  };

  try {
    dictation.start();
    el.record.dataset.on = 'yes';
  } catch {
    dictation = null;
  }
}

function stopDictation() {
  try {
    dictation?.stop();
  } catch {
    /* already stopping */
  }
}

// Press and hold. pointerup anywhere, not just on the button, or letting go
// with your thumb slightly off leaves it recording.
el.record.addEventListener('pointerdown', (event) => {
  event.preventDefault();
  startDictation();
});
for (const name of ['pointerup', 'pointercancel']) {
  window.addEventListener(name, () => dictation && stopDictation());
}

// -- the settings sheet -----------------------------------------------------

/** Redraw the picker from the saved list, keeping the active one selected. */
function renderProviders() {
  const fragment = document.createDocumentFragment();
  for (const entry of settings.providers) {
    const option = document.createElement('option');
    option.value = entry.id;
    option.textContent = entry.name;
    option.selected = entry.id === settings.active;
    fragment.append(option);
  }
  el.provider.replaceChildren(fragment);
  showProvider();
}

/** Fill the edit fields from the selected entry, and say what it can do. */
function showProvider() {
  const entry = activeProvider();
  el.providerName.value = entry.name;
  el.providerUrl.value = entry.url;
  el.providerKey.value = entry.key;
  setProviderStatus('');

  // The one sentence that prevents the worst misunderstanding this app has:
  // adding a provider key and then asking him to open an app, which produces a
  // confident answer about a phone nothing ever touched.
  if (reachesDevice(entry)) {
    el.providerRole.dataset.reach = 'device';
    el.providerRole.textContent = 'Jarvis — pensa e alcança o seu aparelho.';
  } else {
    el.providerRole.dataset.reach = 'chat';
    el.providerRole.textContent =
      'Provedor — só responde. Nada aqui chega ao Termux: as ferramentas de ' +
      'aparelho vivem no Jarvis, não no modelo.';
  }

  // Only entry left? Removing it would leave nothing to talk to.
  el.providerRemove.disabled = settings.providers.length < 2;
}

function setProviderStatus(text, state = '') {
  el.providerStatus.textContent = text;
  el.providerStatus.dataset.state = state;
}

/** Read the edit fields back into the selected entry. */
function collectProvider() {
  const entry = activeProvider();
  const updated = makeProvider({
    id: entry.id,
    name: el.providerName.value,
    url: el.providerUrl.value,
    key: el.providerKey.value,
  });
  settings.providers = settings.providers.map((row) => (row.id === entry.id ? updated : row));
  return updated;
}

el.provider.addEventListener('change', () => {
  collectProvider();
  settings.active = el.provider.value;
  // A model ID belongs to the provider that listed it, so changing provider
  // cannot keep the old one: "qwen2.5:1.5b" means nothing to OpenRouter.
  settings.model = '';
  el.model.value = '';
  el.modelOptions.replaceChildren();
  resolvedModel = '';
  showProvider();
});

el.providerAdd.addEventListener('click', () => {
  collectProvider();
  const entry = makeProvider({ name: 'Novo', url: '' });
  settings.providers = [...settings.providers, entry];
  settings.active = entry.id;
  renderProviders();
  el.providerUrl.focus();
});

el.providerOllama.addEventListener('click', () => {
  collectProvider();
  const entry = termuxOllama();
  const already = settings.providers.find((row) => row.url === entry.url);
  if (already) {
    settings.active = already.id;
  } else {
    settings.providers = [...settings.providers, entry];
    settings.active = entry.id;
  }
  renderProviders();
  loadModels();
});

el.providerRemove.addEventListener('click', () => {
  if (settings.providers.length < 2) return;
  const gone = activeProvider().id;
  settings.providers = settings.providers.filter((row) => row.id !== gone);
  settings.active = settings.providers[0].id;
  renderProviders();
});

el.providerTest.addEventListener('click', () => loadModels());

/**
 * Ask the selected provider what it can run, and fill the picker.
 *
 * Typing a model ID by hand still works — the field is an input with a
 * datalist, not a select — because a brand-new model is always reachable
 * before any catalogue has heard of it.
 */
async function loadModels() {
  const entry = collectProvider();
  setProviderStatus('Perguntando…');
  el.providerTest.disabled = true;
  try {
    const models = await fetchModels(entry);
    const fragment = document.createDocumentFragment();
    for (const id of models) {
      const option = document.createElement('option');
      option.value = id;
      fragment.append(option);
    }
    el.modelOptions.replaceChildren(fragment);
    setProviderStatus(`${models.length} modelos. Escolha um, ou deixe vazio.`, 'good');
    el.modelHint.textContent = 'Vazio usa o padrão do servidor. Qualquer ID pode ser digitado.';
    // One model and nothing chosen? Choosing for them is the obvious kindness.
    if (models.length === 1 && !el.model.value) el.model.value = models[0];
  } catch (error) {
    setProviderStatus(String(error.message || error), 'bad');
  } finally {
    el.providerTest.disabled = false;
  }
}

/**
 * Ask the server what the phone can do, and put it on screen.
 *
 * Not awaited by the sheet's open handler: a backend that is asleep takes
 * seconds to answer, and the settings must be usable meanwhile.
 */
async function loadDevice() {
  el.deviceState.textContent = 'Conferindo…';
  el.deviceState.dataset.tone = '';
  el.deviceDetail.hidden = true;
  el.deviceRefresh.disabled = true;

  const base = serverOf(settings);
  if (!base) {
    el.deviceState.textContent = 'Sem servidor configurado, não há aparelho para conferir.';
    el.deviceRefresh.disabled = false;
    return;
  }

  try {
    const state = await fetchDevice(base, headersFor(activeProvider()));
    const { tone, text } = summarize(state);
    el.deviceState.textContent = text;
    el.deviceState.dataset.tone = tone;

    const rows = details(state);
    el.deviceDetail.replaceChildren(
      ...rows.flatMap(({ label, value }) => {
        const term = document.createElement('p');
        term.className = 'hint';
        term.textContent = `${label}: ${value}`;
        return [term];
      })
    );
    el.deviceDetail.hidden = rows.length === 0;
  } catch (error) {
    el.deviceState.textContent = String(error.message || error);
    el.deviceState.dataset.tone = 'bad';
  } finally {
    el.deviceRefresh.disabled = false;
  }
}

el.deviceRefresh.addEventListener('click', () => loadDevice());

el.menu.addEventListener('click', () => {
  renderProviders();
  loadDevice();
  // Asking on open is what "the models load by themselves" means. It is not
  // awaited: the sheet must be usable while a slow or dead endpoint times out.
  loadModels();
  el.model.value = settings.model;
  el.speak.checked = settings.speak;
  el.wake.checked = settings.wake;
  el.voiceMode.textContent = describeVoice();
  el.settings.showModal();
});

el.settings.addEventListener('close', () => {
  if (el.settings.returnValue === 'demo') {
    runDemo();
    return;
  }

  collectProvider();
  settings = {
    ...settings,
    model: el.model.value.trim(),
    speak: el.speak.checked,
    wake: el.wake.checked,
  };
  resolvedModel = '';
  saveSettings(settings);
  watchAgentEvents();
  armWake();
});

/**
 * Show the face working without a server.
 *
 * Worth keeping past the first run: it is the fastest way to check the
 * animation after touching the field, with no backend in the loop.
 */
async function runDemo() {
  const line =
    'Boa noite. Eu sou o seu Jarvis. Enquanto eu falo, as partículas se movem comigo — quando eu paro, elas param também.';
  field.setShape('face');
  el.shape.textContent = 'esfera';
  setCaption(line);
  await say(line);
}

watchAgentEvents();

// First run: nothing saved and nothing to talk to, so offer the demo rather
// than an input box that can only fail.
if (!serverOf(settings)) {
  el.voiceMode.textContent = describeVoice();
  renderProviders();
  el.settings.showModal();
}

setStatus('em repouso');
