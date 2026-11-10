// Offline support: decides whether this page uses the service worker, and registers it.

/**
 * Only production HTTPS gets the worker by default. A local server and the e2e suite opt in
 * with ?sw=1, so cached files never hide an edit during development. The native app has its
 * files on the device already, and its localhost origin must not count as a web origin.
 * @param {Pick<Location, 'protocol' | 'hostname' | 'search'>} location
 * @param {boolean} hasCapacitor true inside the native app shell
 * @returns {boolean}
 */
export function shouldRegister(location, hasCapacitor) {
  if (hasCapacitor) return false;
  if (location.protocol === 'https:') return true;
  return (
    location.hostname === 'localhost' && new URLSearchParams(location.search).get('sw') === '1'
  );
}

/**
 * Registers the worker after whenReady, so its downloads do not compete with the start of
 * the app. A failure leaves the app as it was without offline support.
 * @param {ServiceWorkerContainer} container navigator.serviceWorker
 * @param {Promise<unknown>} whenReady
 */
export function registerServiceWorker(container, whenReady) {
  whenReady
    .then(() => container.register('sw.js'))
    .catch((error) => console.warn('Offline support is not available:', error));
}
