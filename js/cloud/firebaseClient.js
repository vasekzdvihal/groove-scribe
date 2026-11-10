// Lazy Firebase startup. The SDK loads when the library panel connects: when the user opens
// it, or when a docked panel opens by itself, after Play is ready and the browser is idle.
// The editor does not download it on page load, and the embed pages never do.
import { firebaseConfig } from './firebaseConfig.js';

const EMULATOR_PROJECT_ID = 'demo-groovescribe';

/**
 * Choose the Firebase project for this page.
 *
 * The emulator is reachable only from localhost, with ?emulator=1 in the URL.
 *
 * @param {{hostname: string, search: string}} location
 * @param {object|null} [config]
 * @returns {{config: object, useEmulator: boolean}|null}
 */
export function resolveCloudConfig(location, config = firebaseConfig) {
  const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if (isLocal && new URLSearchParams(location.search).get('emulator') === '1') {
    return {
      useEmulator: true,
      config: {
        apiKey: 'demo-key',
        authDomain: `${EMULATOR_PROJECT_ID}.firebaseapp.com`,
        projectId: EMULATOR_PROJECT_ID,
      },
    };
  }
  return config ? { useEmulator: false, config } : null;
}

let failedImports = 0;

// The browser remembers a failed import of a URL and does not ask again, so a retry needs a
// new URL. No copy of the SDK ran yet, so nothing is loaded twice.
async function importSdk() {
  try {
    return await (failedImports
      ? import(`../vendor/firebase.js?retry=${failedImports}`)
      : import('../vendor/firebase.js'));
  } catch (error) {
    failedImports += 1;
    throw error;
  }
}

// Open a small database of our own first. The SDK has a memory fallback for the errors it
// expects, but a thrown DOMException such as SecurityError stops Firestore for the whole page.
// No timer: a version 1 open of an unused database has nothing to wait for.
function canOpenIndexedDb() {
  return new Promise((resolve) => {
    try {
      const probe = indexedDB.open('grooveScribe.storageProbe');
      probe.onerror = () => resolve(false);
      probe.onsuccess = () => {
        probe.result.close();
        resolve(true);
      };
    } catch {
      resolve(false);
    }
  });
}

export async function connectCloud({ config, useEmulator }) {
  const sdk = await importSdk();
  const app = sdk.initializeApp(config);
  const auth = sdk.getAuth(app);
  // The library stays readable with no network. Without IndexedDB the SDK keeps its default
  // memory cache, so the app works as it did before.
  const persistent = await canOpenIndexedDb();
  const settings = persistent
    ? {
        localCache: sdk.persistentLocalCache({ tabManager: sdk.persistentMultipleTabManager() }),
      }
    : {};
  const db = sdk.initializeFirestore(app, settings);
  if (useEmulator) {
    sdk.connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    sdk.connectFirestoreEmulator(db, '127.0.0.1', 8080);
  }
  return { sdk, auth, db, persistent };
}
