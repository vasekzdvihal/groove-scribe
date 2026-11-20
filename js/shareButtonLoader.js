// The share button library (js/share-button.min.js, a vendored UMD script that defines the
// window global ShareButton, and its stylesheet, about 60 KB together) loads when the share
// popup opens for the first time, not with the editor. The service worker precaches both
// files (scripts/build-www.mjs), so they also load offline.

const SCRIPT = 'js/share-button.min.js';
const STYLESHEET = 'css/share-button.min.css';
// index.html linked the library stylesheet just before this one. The same place keeps the
// cascade, so the editor rules for #shareButton still win.
const EDITOR_STYLESHEET = 'css/groove_writer_orange.css';

/** @type {WeakMap<Document, Promise<void>>} */
const loads = new WeakMap();

/**
 * @param {HTMLScriptElement | HTMLLinkElement} node
 * @param {string} url
 * @returns {Promise<void>}
 */
function whenLoaded(node, url) {
  return new Promise((resolve, reject) => {
    node.addEventListener('load', () => resolve(), { once: true });
    node.addEventListener('error', () => reject(new Error(`${url} did not load`)), {
      once: true,
    });
  });
}

/**
 * Adds the share button script and stylesheet to the page once. Later calls return the same
 * promise. When a file does not load, the promise rejects, the added nodes go away, and the
 * next call tries again.
 * @param {Document} [doc]
 * @returns {Promise<void>} resolves when both files have loaded
 */
export function loadShareButton(doc = document) {
  const pending = loads.get(doc);
  if (pending) return pending;

  const link = doc.createElement('link');
  link.rel = 'stylesheet';
  link.href = STYLESHEET;
  const script = doc.createElement('script');
  script.src = SCRIPT;

  const load = Promise.all([whenLoaded(link, STYLESHEET), whenLoaded(script, SCRIPT)]).then(
    () => undefined,
    (error) => {
      loads.delete(doc);
      link.remove();
      script.remove();
      throw error;
    }
  );
  loads.set(doc, load);

  const editorStylesheet = doc.head.querySelector(`link[href="${EDITOR_STYLESHEET}"]`);
  doc.head.insertBefore(link, editorStylesheet);
  doc.head.appendChild(script);
  return load;
}
