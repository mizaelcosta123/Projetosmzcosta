/**
 * What the phone can actually do, said in the interface instead of a URL.
 *
 * `/v1/device` has been the only way to answer "is my phone connected", and
 * reading it meant typing an address into a browser and parsing JSON by eye.
 * Worse, it answers a question people do not know they are asking: *how* the
 * server reaches the phone, which decides what it can do. A linked runner
 * enforces a policy that was typed on the device. An SSH target is a full
 * shell. "Connected" means both, and they are not the same.
 */

/** Read the device status. Throws with something a person can act on. */
export async function fetchDevice(base, headers, fetchImpl = globalThis.fetch) {
  let response;
  try {
    response = await fetchImpl(`${base}/v1/device`, { headers });
  } catch {
    throw new Error('Não alcancei o servidor para perguntar do aparelho.');
  }
  if (response.status === 401 || response.status === 403) {
    throw new Error('O servidor recusou a chave ao perguntar do aparelho.');
  }
  if (response.status === 404) {
    // The route is newer than some deployed images, and a 404 here reads as
    // "no phone" if nobody says otherwise.
    throw new Error(
      'Este servidor não tem a rota do aparelho — a imagem no ar é anterior a ela. ' +
        'Refaça o deploy.'
    );
  }
  if (!response.ok) throw new Error(`O servidor respondeu ${response.status}.`);

  const payload = await response.json().catch(() => null);
  if (!payload || typeof payload !== 'object') {
    // A 200 full of HTML is what the catch-all route used to answer here, and
    // it reads as working while telling you nothing.
    throw new Error('O servidor respondeu algo que não é o estado do aparelho.');
  }
  return payload;
}

/**
 * One sentence for the top of the panel, and a tone to colour it.
 *
 * @returns {{tone: string, text: string}}
 */
export function summarize(state) {
  if (!state || state.linked !== true) {
    if (state?.transport === 'ssh') {
      return {
        tone: 'good',
        text: `Alcançando o aparelho por SSH (${state.ssh ?? 'configurado'}).`,
      };
    }
    if (state?.transport === 'local') {
      return { tone: 'good', text: 'O Jarvis está rodando dentro do próprio aparelho.' };
    }
    return {
      tone: 'bad',
      text: 'Nenhum aparelho conectado. Rode o runner no Termux para ligar um.',
    };
  }

  const name = state.name || 'aparelho';
  if (state.stale) {
    return {
      tone: 'warn',
      text: `${name} conectado, mas com um runner antigo: ele não controla a tela. Atualize com curl -O <servidor>/v1/device/runner.py`,
    };
  }
  if (state.shell) {
    return { tone: 'warn', text: `${name} conectado, com shell livre.` };
  }
  if (state.ui) {
    return { tone: 'good', text: `${name} conectado, e pode controlar a tela.` };
  }
  return {
    tone: 'good',
    text: `${name} conectado. Para tocar e digitar na tela, reinicie o runner com --allow-ui.`,
  };
}

/**
 * The rows under the sentence: what it can do, and what it has.
 *
 * @returns {{label: string, value: string}[]}
 */
export function details(state) {
  if (!state) return [];
  const rows = [{ label: 'Como', value: ROADS[state.transport] ?? state.transport ?? '—' }];

  if (state.transport === 'ssh' && state.ssh) {
    rows.push({ label: 'Endereço', value: state.ssh });
  }
  if (state.linked) {
    rows.push({ label: 'Controlar a tela', value: state.ui ? 'sim' : 'não' });
    rows.push({ label: 'Shell livre', value: state.shell ? 'sim' : 'não' });
    const binaries = Array.isArray(state.binaries) ? state.binaries : [];
    rows.push({
      label: 'Helpers',
      value: binaries.length ? `${binaries.length} instalados` : 'nenhum',
    });
  }
  return rows;
}

const ROADS = {
  bridge: 'ponte (o runner ligado ao servidor)',
  ssh: 'SSH',
  local: 'aqui mesmo, dentro do Termux',
  none: 'nenhum caminho disponível',
};
