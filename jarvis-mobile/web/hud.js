/**
 * The heads-up display: the futuristic chrome that frames the field.
 *
 * The reticle rings, corner brackets and scanline are static CSS — they cost
 * nothing to animate and never need JavaScript. This module owns only the parts
 * that must be *alive*: the telemetry readouts that tick, and the reaction to
 * the interface's state so the HUD leans forward when the agents are thinking.
 *
 * None of it is load-bearing. A screen reader gets the status line and the
 * caption; the HUD is decoration marked aria-hidden, so it is free to be as
 * theatrical as it likes.
 */

/** A telemetry row: a fixed label and a value that drifts around a baseline. */
const READOUTS = [
  { key: 'core', label: 'NÚCLEO', render: () => 'ESTÁVEL' },
  {
    key: 'sync',
    label: 'SINCRONIA',
    render: (t) => `${(97.5 + Math.sin(t / 900) * 1.6 + Math.random() * 0.3).toFixed(1)}%`,
  },
  {
    key: 'lat',
    label: 'LATÊNCIA',
    render: () => `${(28 + Math.round(Math.random() * 22))} ms`,
  },
  { key: 'agents', label: 'AGENTES', render: () => '5/5 ONLINE' },
  {
    key: 'load',
    label: 'CARGA',
    render: (t) => `${Math.max(4, Math.round(9 + Math.sin(t / 1200) * 5 + Math.random() * 3))}%`,
  },
];

export class HUD {
  /**
   * @param {object} refs
   * @param {HTMLElement} refs.root      The HUD layer; carries the accent hue.
   * @param {HTMLElement} refs.telemetry Container for the readout rows.
   * @param {HTMLElement} [refs.mode]    Small mode word (e.g. "ROTEANDO").
   */
  constructor({ root, telemetry, mode }) {
    this.root = root;
    this.telemetry = telemetry;
    this.mode = mode;
    this.state = 'idle';
    this.values = new Map();
    this._buildTelemetry();
  }

  _buildTelemetry() {
    const fragment = document.createDocumentFragment();
    for (const readout of READOUTS) {
      const row = document.createElement('div');
      row.className = 'readout';

      const label = document.createElement('span');
      label.className = 'readout-label';
      label.textContent = readout.label;

      const value = document.createElement('span');
      value.className = 'readout-value';
      value.textContent = readout.render(0);

      row.append(label, value);
      fragment.append(row);
      this.values.set(readout.key, value);
    }
    this.telemetry.replaceChildren(fragment);
  }

  /** Borrow the active agent's hue for every stroke and glow in the chrome. */
  setAgent(agent) {
    this.root.style.setProperty('--hud', `${agent.hue}`);
    this.root.style.setProperty('--hud-accent', `${agent.accentHue}`);
    if (this.values.has('agents')) {
      // A tiny nod to orchestration: name who currently holds the field.
      this.values.get('agents').textContent =
        agent.id === 'jarvis' ? '5/5 ONLINE' : `${agent.name} ATIVO`;
    }
  }

  /**
   * React to what the interface is doing.
   *
   * @param {'idle'|'thinking'|'speaking'|'error'} state
   */
  setState(state) {
    this.state = state;
    this.root.dataset.state = state;
    if (this.mode) {
      const word = {
        idle: 'EM REPOUSO',
        thinking: 'ROTEANDO',
        speaking: 'TRANSMITINDO',
        error: 'FALHA',
      }[state];
      this.mode.textContent = word ?? '';
    }
  }

  /** Tick the readouts on a slow interval — fast enough to feel live, slow
   *  enough not to become noise. */
  start() {
    if (this._timer) return;
    const tick = () => {
      const t = performance.now();
      for (const readout of READOUTS) {
        if (readout.key === 'agents') continue; // owned by setAgent
        const cell = this.values.get(readout.key);
        if (cell) cell.textContent = readout.render(t);
      }
    };
    tick();
    this._timer = setInterval(tick, 1400);
  }

  stop() {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
  }
}
