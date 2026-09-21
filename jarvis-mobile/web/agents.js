/**
 * The agent roster.
 *
 * The interface is no longer a single voice — it is a small constellation of
 * specialists behind one field. JARVIS is the orchestrator you talk to; he
 * routes work to the others and each one carries its own colour so that a
 * handover is visible in the field itself, not just in the text.
 *
 * An agent is deliberately just data: a name, a job, and a palette. The field
 * renders the palette, the dock renders the name, and `app.js` decides who is
 * active. Nothing here reaches into the DOM or the network, which keeps the
 * roster trivial to extend — add an object and it appears everywhere.
 */

/**
 * @typedef {object} Agent
 * @property {string} id       Stable key, also used for the display mode hint.
 * @property {string} name     Shown in the dock and the callsign.
 * @property {string} role     One-line specialty.
 * @property {string} tagline  How the agent introduces itself.
 * @property {number} hue      Base hue for the particle field, 0..360.
 * @property {number} accentHue Accent hue; sits roughly opposite the base.
 * @property {string} glyph    Single-character mark for the dock node.
 */

/** @type {Agent[]} */
export const AGENTS = [
  {
    id: 'jarvis',
    name: 'JARVIS',
    role: 'Orquestrador',
    tagline: 'Coordeno os outros agentes e falo com você.',
    hue: 192,
    accentHue: 38,
    glyph: 'J',
  },
  {
    id: 'atlas',
    name: 'ATLAS',
    role: 'Pesquisa & Dados',
    tagline: 'Busco, cruzo e sintetizo informação.',
    hue: 268,
    accentHue: 48,
    glyph: 'A',
  },
  {
    id: 'nova',
    name: 'NOVA',
    role: 'Criação',
    tagline: 'Escrevo, imagino e desenho ideias.',
    hue: 324,
    accentHue: 188,
    glyph: 'N',
  },
  {
    id: 'vulcan',
    name: 'VULCAN',
    role: 'Engenharia',
    tagline: 'Codifico, depuro e automatizo.',
    hue: 156,
    accentHue: 40,
    glyph: 'V',
  },
  {
    id: 'echo',
    name: 'ECHO',
    role: 'Voz & Contexto',
    tagline: 'Converso, resumo e mantenho o fio da conversa.',
    hue: 28,
    accentHue: 200,
    glyph: 'E',
  },
];

/** Look an agent up by id, falling back to the orchestrator. */
export function agentById(id) {
  return AGENTS.find((agent) => agent.id === id) ?? AGENTS[0];
}

/**
 * Turn an agent's hue into a CSS colour the chrome can borrow.
 *
 * The field paints itself from the hue directly; the HTML chrome (dock nodes,
 * telemetry, active glow) reads this so a recolour ripples out from the field
 * to every edge of the screen at once.
 */
export function agentColor(agent, { light = 60, sat = 90, alpha = 1 } = {}) {
  return `hsla(${agent.hue}, ${sat}%, ${light}%, ${alpha})`;
}

/**
 * The interactive agent dock.
 *
 * Renders one node per agent and reports selection through a callback. It owns
 * only its own row of buttons — the field, status and telemetry are wired up by
 * the caller, which keeps this a dumb, testable view.
 */
export class AgentDock {
  /**
   * @param {HTMLElement} root Container to render the nodes into.
   * @param {(agent: Agent) => void} onSelect Called with the chosen agent.
   */
  constructor(root, onSelect) {
    this.root = root;
    this.onSelect = onSelect;
    this.activeId = AGENTS[0].id;
    this.buttons = new Map();
    this._render();
  }

  _render() {
    const fragment = document.createDocumentFragment();
    for (const agent of AGENTS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'agent';
      button.dataset.id = agent.id;
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-label', `${agent.name} — ${agent.role}`);
      // The dot carries the agent's colour; CSS reads it from the variable so
      // the whole node lights up in the agent's hue when active.
      button.style.setProperty('--agent', `${agent.hue}`);

      const node = document.createElement('span');
      node.className = 'agent-node';
      node.textContent = agent.glyph;
      node.setAttribute('aria-hidden', 'true');

      const name = document.createElement('span');
      name.className = 'agent-name';
      name.textContent = agent.name;

      button.append(node, name);
      button.addEventListener('click', () => this.select(agent.id));
      this.buttons.set(agent.id, button);
      fragment.append(button);
    }
    this.root.replaceChildren(fragment);
    this._paint();
  }

  /** Make an agent active and notify the caller. */
  select(id) {
    const agent = agentById(id);
    this.activeId = agent.id;
    this._paint();
    this.onSelect?.(agent);
  }

  /** Reflect the active agent without firing the callback. */
  setActive(id) {
    this.activeId = agentById(id).id;
    this._paint();
  }

  _paint() {
    for (const [id, button] of this.buttons) {
      const active = id === this.activeId;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', String(active));
      button.tabIndex = active ? 0 : -1;
    }
  }
}
