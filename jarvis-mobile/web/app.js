/**
 * Wires the particle field to a voice and to an OpenJarvis server.
 *
 * The field is the interface. Text is a caption under it, not a transcript —
 * the point of this GUI is that you watch him speak rather than read a log.
 */

import { ParticleField } from './particles.js';
import { AnalyserDriver, SynthesisDriver, createVoiceDriver } from './voice.js';

const SETTINGS_KEY = 'jarvis.settings.v1';

const el = {
  canvas: document.getElementById('field'),
  status: document.getElementById('status'),
  caption: document.getElementById('caption'),
  composer: document.getElementById('composer'),
  prompt: document.getElementById('prompt'),
  send: document.getElementById('send'),
  shape: document.getElementById('shape'),
  menu: document.getElementById('menu'),
  settings: document.getElementById('settings'),
  serverUrl: document.getElementById('server-url'),
  apiKey: document.getElementById('api-key'),
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
  const fallback = { serverUrl: '', apiKey: '', model: '', speak: true };
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

function saveSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* Not fatal — the session simply will not be remembered. */
  }
}

let settings = loadSettings();

// Served from the OpenJarvis server itself? Then it is the default target and
// no one has to type a URL.
const sameOrigin = location.protocol.startsWith('http') ? location.origin : '';
const serverOf = (s) => (s.serverUrl || sameOrigin).replace(/\/+$/, '');

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



// -- the model picker -------------------------------------------------------

/**
 * Offer the provider's free models as suggestions.
 *
 * The list is written beside this page by `python -m jarvis_mobile.models
 * --refresh`, so it is fetched from our own origin — no CORS grant and no
 * extra route on the server. It is deliberately not compiled into the page:
 * free models arrive and retire constantly, and an ID baked in here would
 * eventually fail at request time with nothing useful to say.
 *
 * Absent file means no suggestions, which is a complete state: the field is a
 * text input and any ID can still be typed.
 */
let modelsLoaded = false;

async function loadModelSuggestions() {
  if (modelsLoaded) return;
  modelsLoaded = true;

  const rows = await fetch('./models.json')
    .then((response) => (response.ok ? response.json() : null))
    .then((payload) => payload?.free)
    .catch(() => null);

  if (!Array.isArray(rows) || rows.length === 0) {
    el.modelHint.textContent =
      'Deixe vazio para usar o modelo do servidor. Para listar os gratuitos: ' +
      'python -m jarvis_mobile.models --refresh';
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const row of rows) {
    if (!row?.id) continue;
    const option = document.createElement('option');
    option.value = row.id;
    // The context window is the one number that decides a free model's use.
    const context = row.context ? ` · ${Math.round(row.context / 1000)}K` : '';
    option.label = `${row.name ?? row.id}${context}`;
    fragment.append(option);
  }
  el.modelOptions.replaceChildren(fragment);
  el.modelHint.textContent = `${rows.length} modelos gratuitos disponíveis — ou digite qualquer ID.`;
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
  const protocols = settings.apiKey
    ? ['openjarvis.auth.v1', 'openjarvis.key.b64url.' + base64url(settings.apiKey)]
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
  if (settings.apiKey) headers.Authorization = `Bearer ${settings.apiKey}`;

  const body = {
    model: await modelFor(base, headers),
    messages: [{ role: 'user', content: text }],
    stream: true,
  };

  const response = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
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
  el.composer.dataset.ready = String(el.prompt.value.trim().length > 0);
};
el.prompt.addEventListener('input', syncReady);
syncReady();

el.composer.addEventListener('submit', async (event) => {
  event.preventDefault();
  const text = el.prompt.value.trim();
  if (!text || busy) return;

  busy = true;
  el.send.disabled = true;
  el.prompt.value = '';
  syncReady();
  setCaption('');
  setStatus('pensando');

  try {
    let shown = '';
    const reply = await streamReply(text, (chunk) => {
      shown += chunk;
      setCaption(shown);
    });
    await say(reply);
    if (!settings.speak) setStatus('em repouso');
  } catch (error) {
    setStatus('erro', 'error');
    setCaption(String(error.message || error));
  } finally {
    field.setThinking(false);
    busy = false;
    el.send.disabled = false;
  }
});

// The toggle stays as a manual override; asking him is the intended path.
el.shape.addEventListener('click', () => {
  applyMode(field.targetShape === 'face' ? 'orb' : 'face');
});

el.menu.addEventListener('click', () => {
  el.serverUrl.value = settings.serverUrl;
  el.apiKey.value = settings.apiKey;
  el.model.value = settings.model;
  el.speak.checked = settings.speak;
  el.voiceMode.textContent = describeVoice();
  loadModelSuggestions();
  el.settings.showModal();
});

el.settings.addEventListener('close', () => {
  if (el.settings.returnValue === 'demo') {
    runDemo();
    return;
  }
  settings = {
    serverUrl: el.serverUrl.value.trim(),
    apiKey: el.apiKey.value.trim(),
    model: el.model.value.trim(),
    speak: el.speak.checked,
  };
  resolvedModel = '';
  saveSettings(settings);
  watchAgentEvents();
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
  loadModelSuggestions();
  el.settings.showModal();
}

setStatus('em repouso');
