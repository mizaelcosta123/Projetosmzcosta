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
  field.setLevel(voice.sample());
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
  if (!settings.speak || !text.trim()) return;
  try {
    if (audioUrl) {
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

// -- status and caption -----------------------------------------------------

function setStatus(text, state = '') {
  el.status.textContent = text;
  el.status.dataset.state = state;
}

function setCaption(text) {
  el.caption.textContent = text;
  el.caption.scrollTop = el.caption.scrollHeight;
}

// -- talking to the server --------------------------------------------------

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
    messages: [{ role: 'user', content: text }],
    stream: true,
  };
  if (settings.model) body.model = settings.model;

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

el.composer.addEventListener('submit', async (event) => {
  event.preventDefault();
  const text = el.prompt.value.trim();
  if (!text || busy) return;

  busy = true;
  el.send.disabled = true;
  el.prompt.value = '';
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
    busy = false;
    el.send.disabled = false;
  }
});

el.shape.addEventListener('click', () => {
  const next = field.targetShape === 'face' ? 'orb' : 'face';
  field.setShape(next);
  el.shape.textContent = next === 'face' ? 'esfera' : 'rosto';
});

el.menu.addEventListener('click', () => {
  el.serverUrl.value = settings.serverUrl;
  el.apiKey.value = settings.apiKey;
  el.model.value = settings.model;
  el.speak.checked = settings.speak;
  el.voiceMode.textContent = describeVoice();
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
  saveSettings(settings);
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

// First run: nothing saved and nothing to talk to, so offer the demo rather
// than an input box that can only fail.
if (!serverOf(settings)) {
  el.voiceMode.textContent = describeVoice();
  el.settings.showModal();
}

setStatus('em repouso');
