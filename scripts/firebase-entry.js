// The only Firebase APIs the app uses. scripts/vendor-firebase.mjs bundles this
// file into js/vendor/firebase.js, so the app stays free of a build step and of
// third-party requests at load time.
export { initializeApp } from 'firebase/app';
export {
  GoogleAuthProvider,
  connectAuthEmulator,
  getAuth,
  onAuthStateChanged,
  signInWithCredential, // used only by tests-cloud against the Auth emulator
  signInWithPopup,
  signOut,
} from 'firebase/auth';
export {
  addDoc,
  collection,
  connectFirestoreEmulator,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getDocsFromCache,
  getDocsFromServer,
  initializeFirestore,
  orderBy,
  persistentLocalCache,
  persistentMultipleTabManager,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
