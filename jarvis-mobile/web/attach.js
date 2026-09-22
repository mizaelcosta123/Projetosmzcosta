/**
 * Giving him something to look at.
 *
 * A message with a picture in it is not a string any more, and that is the
 * whole difficulty. The OpenAI shape for it is a list of content blocks —
 * `[{type:'text'}, {type:'image_url'}]` — and a provider like OpenRouter takes
 * that directly. A Jarvis backend does not: OpenJarvis types the field as
 * `content: str`, so a list comes back 422 before any model sees it.
 *
 * So the picture only reaches a model when the app is pointed at a provider,
 * and the failure has to say that rather than "422". Somebody who attached a
 * photo and got a status code has no way to guess that the fix is a different
 * entry in the settings sheet.
 */

/** Longest edge, in pixels, before an image is scaled down.
 *
 * A phone camera hands you 4000px. Models downsample to a few hundred anyway,
 * and the difference on the wire is megabytes of base64 on a mobile uplink. */
const MAX_EDGE = 1280;

/** JPEG quality for the re-encode. 0.82 is where the artefacts stop being
 * visible in a photograph and the file is still a third of the size. */
const QUALITY = 0.82;

/** What can be attached. Anything else is text we read, or nothing we can use. */
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
export const TEXT_TYPES = ['text/', 'application/json', 'application/xml'];

/**
 * Shrink an image and return it as a data URL.
 *
 * @param {Blob} blob
 * @param {object} [deps] Injected by the tests, which have no DOM.
 * @returns {Promise<string>}
 */
export async function toDataUrl(blob, deps = {}) {
  const createBitmap = deps.createImageBitmap ?? globalThis.createImageBitmap;
  const makeCanvas = deps.makeCanvas ?? defaultCanvas;

  const bitmap = await createBitmap(blob);
  const { width, height } = fit(bitmap.width, bitmap.height, MAX_EDGE);
  const canvas = makeCanvas(width, height);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();
  return canvas.toDataURL('image/jpeg', QUALITY);
}

function defaultCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/**
 * The size an image should be resampled to.
 *
 * Only ever shrinks: enlarging a small image costs bytes and adds nothing a
 * model can use.
 */
export function fit(width, height, max = MAX_EDGE) {
  const longest = Math.max(width, height);
  if (longest <= max) return { width, height };
  const scale = max / longest;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/** Is this something we can show him, rather than read to him? */
export function isImage(type) {
  return IMAGE_TYPES.includes(String(type || '').toLowerCase());
}

/** Is this something we can read as text? */
export function isText(type, name = '') {
  const kind = String(type || '').toLowerCase();
  if (TEXT_TYPES.some((prefix) => kind.startsWith(prefix))) return true;
  // Browsers report an empty type for plenty of ordinary files, so fall back
  // to the extension rather than refusing a .md somebody just picked.
  return /\.(txt|md|csv|json|ya?ml|js|ts|py|html?|css|log)$/i.test(name);
}

/**
 * Turn a message and its attachments into what goes on the wire.
 *
 * Returns a plain string when there is nothing attached — not a one-element
 * list — because that is what every backend accepts, and a picture is the only
 * reason to reach for the other shape.
 *
 * @param {string} text
 * @param {{kind: string, dataUrl?: string, text?: string, name?: string}[]} attachments
 * @returns {string | object[]}
 */
export function buildContent(text, attachments = []) {
  const images = attachments.filter((item) => item?.kind === 'image' && item.dataUrl);
  const documents = attachments.filter((item) => item?.kind === 'text' && item.text);

  // Text files are quoted into the message: no backend refuses a longer
  // string, and it keeps a .csv working against a server that would 422 on
  // content blocks.
  let written = String(text ?? '');
  for (const doc of documents) {
    written += `\n\n--- ${doc.name || 'arquivo'} ---\n${doc.text}`;
  }

  if (images.length === 0) return written;

  return [
    { type: 'text', text: written || 'O que você vê nesta imagem?' },
    ...images.map((image) => ({ type: 'image_url', image_url: { url: image.dataUrl } })),
  ];
}

/**
 * Say why a request carrying a picture was refused.
 *
 * A 422 or a 400 from a backend whose `content` is a string is the single
 * most likely outcome, and the status alone points nowhere.
 *
 * @param {number} status
 * @param {boolean} hadImage
 * @param {boolean} throughBackend Whether the target is a Jarvis, not a provider.
 */
export function explainRefusal(status, hadImage, throughBackend) {
  if (!hadImage) return '';
  if (status !== 422 && status !== 400) return '';
  if (throughBackend) {
    return (
      'Este servidor Jarvis não aceita imagens: o campo da mensagem é texto, ' +
      'e a imagem é recusada antes de qualquer modelo ver. Em Configurações → ' +
      'Onde ele pensa, escolha um provedor direto com um modelo de visão.'
    );
  }
  return (
    'O provedor recusou a imagem. O modelo escolhido provavelmente não tem visão — ' +
    'procure um marcado como "vision" no catálogo e escolha ele em Modelo.'
  );
}
