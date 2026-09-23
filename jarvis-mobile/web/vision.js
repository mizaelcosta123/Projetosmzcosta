/**
 * Loading the hand model.
 *
 * MediaPipe's HandLandmarker (Apache 2.0): 21 points per hand, up to two
 * hands, fast enough on a phone's GPU to run on every camera frame. Loaded
 * on demand -- the library and its WebAssembly from jsDelivr, the model from
 * Google -- because it is ~20 MB the first time, and nobody who never opens
 * the camera should pay that.
 *
 * Both URLs carry a version, so they never change under a cached copy: the
 * service worker keeps them (see `sw.js`), and after the first time the
 * camera mode works with no signal at all.
 *
 * The server's Content-Security-Policy has to allow jsDelivr in `script-src`
 * for this -- see `webheaders.py`. Without that the import is refused and
 * the camera still opens, with touch instead of hands.
 */

/** The library's version. Pinned: an unpinned CDN URL is a different
 *  program every time a release goes out. */
export const MEDIAPIPE_VERSION = '1.0.1';

export const LIBRARY = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}`;

/** float16, version 1: the model the library's own documentation uses. */
export const MODEL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

/** URLs that never change and are worth keeping for offline use. */
export const IMMUTABLE = [LIBRARY, MODEL];

/**
 * Build a HandLandmarker for video.
 *
 * Tries the GPU first and falls back to the CPU: a phone whose WebGL is
 * blocklisted still gets hands, at a lower frame rate.
 *
 * @param {object} [options]
 * @param {(url: string) => Promise<any>} [options.importer] Injectable, for tests.
 * @returns {Promise<{landmarker: any, delegate: string}>}
 */
export async function loadHands({
  library = LIBRARY,
  model = MODEL,
  importer = (url) => import(url),
  hands = 2,
} = {}) {
  const { FilesetResolver, HandLandmarker } = await importer(`${library}/vision_bundle.mjs`);
  const files = await FilesetResolver.forVisionTasks(`${library}/wasm`);
  let lastError;
  for (const delegate of ['GPU', 'CPU']) {
    try {
      const landmarker = await HandLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: model, delegate },
        runningMode: 'VIDEO',
        numHands: hands,
        minHandDetectionConfidence: 0.5,
        minHandPresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
      return { landmarker, delegate };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error('HandLandmarker não carregou');
}

/**
 * Why hands are not available, in a sentence someone can act on.
 *
 * The three causes look identical from the page -- a rejected promise -- and
 * need three different fixes.
 */
export function explainLoadFailure(error) {
  const text = String(error?.message ?? error ?? '');
  if (/Content Security Policy|CSP|violates/i.test(text)) {
    return 'O servidor não deixa carregar o rastreamento de mãos: o cabeçalho de segurança dele ' +
      'é de uma versão anterior. Faça o Manual Deploy do backend no Render. A câmera continua, com toque na tela.';
  }
  if (/Failed to fetch|NetworkError|dynamically imported module|Load failed/i.test(text)) {
    return 'Não consegui baixar o rastreamento de mãos (~20 MB na primeira vez). ' +
      'Confira a conexão; depois da primeira vez ele funciona sem internet.';
  }
  if (/WebGL|wasm|WebAssembly|memory/i.test(text)) {
    return 'Este aparelho não conseguiu rodar o modelo de mãos. A câmera continua, com toque na tela.';
  }
  return `O rastreamento de mãos não carregou: ${text || 'motivo desconhecido'}. A câmera continua, com toque na tela.`;
}
