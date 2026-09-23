/**
 * Asking the browser for what he needs, and saying what happened.
 *
 * Three facts shape this whole file:
 *
 *  1. `navigator.permissions.query()` **never** prompts. It reports. The
 *     prompt only ever comes from the real call -- `getUserMedia`,
 *     `getCurrentPosition`. So a panel that only queries will sit there
 *     saying "prompt" forever and the user will conclude it is broken.
 *     Every entry here therefore has both: a `read` that reports and an
 *     `ask` that actually asks.
 *
 *  2. On an insecure origin `navigator.mediaDevices` is not "denied", it is
 *     **undefined**. Calling through it throws a TypeError about reading a
 *     property of undefined, which tells the user nothing. That is worth
 *     detecting by name, because the fix is completely different: it is not
 *     a permission at all, it is the address bar.
 *
 *  3. `permissions.query({ name })` throws TypeError for names a browser
 *     does not know -- Firefox has no 'camera', older Safari has none of
 *     them. Unknown is not denied, and must not be drawn as a refusal.
 */

/** Is this page allowed to ask at all? */
export function secure() {
  if (typeof globalThis.isSecureContext === 'boolean') return globalThis.isSecureContext;
  // Ancient browsers: HTTPS and localhost are the two secure origins.
  const { protocol, hostname } = globalThis.location ?? {};
  return protocol === 'https:' || hostname === 'localhost' || hostname === '127.0.0.1';
}

/**
 * Is this page allowed to ask for this feature at all?
 *
 * Separate from whether the *user* has refused, and the distinction decides
 * where somebody is sent. A `Permissions-Policy` header naming an empty
 * allowlist -- `camera=()` -- means no origin may use the feature, this one
 * included. The browser then rejects `getUserMedia` with `NotAllowedError`,
 * the same name it uses when a person clicks Block, and draws no prompt at
 * all. Reading it as a refusal sends them to the browser's site settings,
 * where they will grant the permission, watch nothing change, and grant it
 * again. It is the server that has to change.
 *
 * @param {string} feature A policy-controlled feature name.
 * @returns {boolean} False only when the header definitely forbids it.
 */
export function allowedByPolicy(feature) {
  const policy = globalThis.document?.featurePolicy ?? globalThis.document?.permissionsPolicy;
  if (!policy?.allowsFeature) return true; // Firefox and Safari: cannot tell.
  try {
    return policy.allowsFeature(feature);
  } catch {
    return true;
  }
}

/** The states a row can be in. `unknown` means the browser would not say. */
export const STATE = {
  granted: 'granted',
  denied: 'denied',
  prompt: 'prompt',
  unknown: 'unknown',
  missing: 'missing', // the API itself is not here
  insecure: 'insecure', // http:, so nothing may be asked
  blocked: 'blocked', // the server's Permissions-Policy forbids it
};

/** Human wording, in the user's language, for each state. */
export const SAYS = {
  granted: 'liberado',
  denied: 'bloqueado',
  prompt: 'vai perguntar',
  unknown: 'não sei dizer',
  missing: 'não existe neste navegador',
  insecure: 'exige HTTPS',
  blocked: 'bloqueado pelo servidor',
};

/**
 * Ask the Permissions API, without prompting.
 *
 * @param {string} name A PermissionName.
 * @returns {Promise<string>} One of STATE.
 */
async function read(name, feature = name) {
  if (!secure()) return STATE.insecure;
  // Checked before the query, because this one cannot be overruled: whatever
  // the Permissions API reports, a forbidden feature will not open.
  if (!allowedByPolicy(feature)) return STATE.blocked;
  const permissions = globalThis.navigator?.permissions;
  if (!permissions?.query) return STATE.unknown;
  try {
    const status = await permissions.query({ name });
    return status.state in STATE ? status.state : STATE.unknown;
  } catch {
    // TypeError for a name this browser does not know. Unknown, not denied:
    // Firefox has no 'camera' and the camera still works there.
    return STATE.unknown;
  }
}

/** Turn a real rejection into a state plus something worth reading. */
export function explain(error, what, feature) {
  const name = error?.name ?? '';
  if ((name === 'NotAllowedError' || name === 'PermissionDeniedError') && feature
      && !allowedByPolicy(feature)) {
    // Same error name as a refusal, entirely different cause and fix.
    return {
      state: STATE.blocked,
      note:
        `O servidor não deixa esta página pedir ${what}. Ele manda um cabeçalho ` +
        '`Permissions-Policy` com a lista vazia, e nesse caso o navegador nem ' +
        'chega a perguntar. Liberar nas configurações do navegador não resolve — ' +
        'quem precisa mudar é o servidor.',
    };
  }
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return {
      state: STATE.denied,
      note:
        `Você (ou o navegador) recusou ${what}. Um bloqueio não pode ser ` +
        'desfeito por esta página: toque no cadeado ao lado do endereço e ' +
        'libere por lá.',
    };
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return { state: STATE.missing, note: `Este aparelho não tem ${what}.` };
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return {
      state: STATE.unknown,
      note: `${what} existe, mas outro aplicativo está usando. Feche o outro e tente de novo.`,
    };
  }
  if (name === 'SecurityError' || error instanceof TypeError) {
    // The undefined-mediaDevices case lands here, and it is not a permission.
    return {
      state: secure() ? STATE.unknown : STATE.insecure,
      note: secure()
        ? `Não consegui pedir ${what}: ${error?.message || error}`
        : 'Esta página está em HTTP. O navegador não deixa nem perguntar — abra pelo endereço https.',
    };
  }
  return { state: STATE.unknown, note: `Não consegui pedir ${what}: ${error?.message || error}` };
}

/** Open a stream only to prove the permission, then give the hardware back. */
async function proveMedia(constraints, what, feature) {
  if (!secure()) {
    return {
      state: STATE.insecure,
      note: 'Esta página está em HTTP. O navegador não deixa nem perguntar — abra pelo endereço https.',
    };
  }
  const media = globalThis.navigator?.mediaDevices;
  if (!media?.getUserMedia) {
    return { state: STATE.missing, note: `Este navegador não expõe ${what}.` };
  }
  let stream;
  try {
    stream = await media.getUserMedia(constraints);
  } catch (error) {
    return explain(error, what, feature);
  }
  // Every track, explicitly. Dropping the reference leaves the light on.
  stream.getTracks().forEach((track) => track.stop());
  return { state: STATE.granted, note: '' };
}

/**
 * Everything he might need, in the order it is worth granting.
 *
 * `why` is shown next to the switch. Nobody grants a microphone to a page
 * that does not say what it wants it for, and they are right not to.
 */
export const PERMISSIONS = [
  {
    id: 'microphone',
    label: 'Microfone',
    why: 'Falar com ele sem digitar, e o ditado.',
    read: () => read('microphone'),
    ask: () => proveMedia({ audio: true }, 'o microfone', 'microphone'),
  },
  {
    id: 'camera',
    label: 'Câmera',
    why: 'Mostrar algo a ele pela câmera.',
    read: () => read('camera'),
    ask: () => proveMedia({ video: true }, 'a câmera', 'camera'),
  },
  {
    id: 'geolocation',
    label: 'Localização',
    why: 'Responder sobre o tempo e o que há por perto. Só vai junto quando a pergunta é sobre isso, e arredondada para ~1 km.',
    read: () => read('geolocation'),
    ask: () =>
      new Promise((resolve) => {
        if (!secure()) {
          resolve({
            state: STATE.insecure,
            note: 'Esta página está em HTTP. O navegador não deixa nem perguntar — abra pelo endereço https.',
          });
          return;
        }
        if (!allowedByPolicy('geolocation')) {
          resolve(explain({ name: 'NotAllowedError' }, 'a localização', 'geolocation'));
          return;
        }
        const geo = globalThis.navigator?.geolocation;
        if (!geo?.getCurrentPosition) {
          resolve({ state: STATE.missing, note: 'Este navegador não expõe localização.' });
          return;
        }
        geo.getCurrentPosition(
          () => resolve({ state: STATE.granted, note: '' }),
          (error) => {
            // GeolocationPositionError is its own thing: a numeric `code`,
            // and no `name`. PERMISSION_DENIED is 1.
            if (error?.code === 1)
              resolve(explain({ name: 'NotAllowedError' }, 'a localização', 'geolocation'));
            else if (error?.code === 2)
              resolve({
                state: STATE.unknown,
                note: 'O aparelho não conseguiu se localizar agora. Costuma ser o GPS desligado.',
              });
            else
              resolve({
                state: STATE.unknown,
                note: 'A localização demorou demais para responder.',
              });
          },
          { timeout: 10000, maximumAge: 60000 }
        );
      }),
  },
  {
    id: 'notifications',
    label: 'Notificações',
    why: 'Avisar quando a resposta chegar e você estiver em outro app.',
    read: async () => {
      const api = globalThis.Notification;
      if (!api) return STATE.missing;
      const known = { granted: STATE.granted, denied: STATE.denied, default: STATE.prompt };
      return known[api.permission] ?? STATE.unknown;
    },
    ask: async () => {
      const api = globalThis.Notification;
      if (!api?.requestPermission) {
        return { state: STATE.missing, note: 'Este navegador não expõe notificações.' };
      }
      try {
        const answer = await api.requestPermission();
        if (answer === 'granted') return { state: STATE.granted, note: '' };
        if (answer === 'denied') return explain({ name: 'NotAllowedError' }, 'as notificações');
        return { state: STATE.prompt, note: 'Você fechou o aviso sem responder.' };
      } catch (error) {
        return explain(error, 'as notificações');
      }
    },
  },
];

/** Look up one entry by id. */
export function find(id) {
  return PERMISSIONS.find((entry) => entry.id === id);
}

/**
 * The state of everything, without prompting for anything.
 *
 * @returns {Promise<Record<string, string>>} id -> STATE
 */
export async function inspect() {
  const pairs = await Promise.all(
    PERMISSIONS.map(async (entry) => [entry.id, await entry.read()])
  );
  return Object.fromEntries(pairs);
}
