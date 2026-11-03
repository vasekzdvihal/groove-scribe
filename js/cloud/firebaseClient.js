// Lazy Firebase startup. Only the library page imports this module, so the editor
// and the embed pages never load the SDK.
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

export async function connectCloud({ config, useEmulator }) {
  const sdk = await import('../vendor/firebase.js');
  const app = sdk.initializeApp(config);
  const auth = sdk.getAuth(app);
  const db = sdk.initializeFirestore(app, {});
  if (useEmulator) {
    sdk.connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    sdk.connectFirestoreEmulator(db, '127.0.0.1', 8080);
  }
  return { sdk, auth, db };
}
