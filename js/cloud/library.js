// Firestore access for one signed-in user: profile, lessons, and saved grooves.
// A groove is stored as its existing URL query string, the format the editor reads.

const BATCH_LIMIT = 400;

/**
 * @param {object} sdk  The Firebase module exports.
 * @param {object} db   The Firestore instance.
 * @param {string} uid  The signed-in user.
 */
export function createLibrary(sdk, db, uid) {
  const lessons = sdk.collection(db, 'lessons');
  const grooves = sdk.collection(db, 'grooves');
  const now = () => sdk.serverTimestamp();

  // Offline, the SDK can wait about 10 s for the server before it answers from the cache.
  // The browser already knows there is no network, so skip that wait. The cached list is
  // filtered by owner like the server list, so another account on this device never shows.
  async function listOwned(ref, sortField, direction) {
    const owned = sdk.query(
      ref,
      sdk.where('ownerId', '==', uid),
      sdk.orderBy(sortField, direction)
    );
    const snapshot = await (navigator.onLine === false
      ? sdk.getDocsFromCache(owned)
      : sdk.getDocs(owned));
    return {
      items: snapshot.docs.map((item) => ({ id: item.id, ...item.data() })),
      fromCache: snapshot.metadata.fromCache,
    };
  }

  return {
    async saveProfile({ displayName, photoURL }) {
      const ref = sdk.doc(db, 'users', uid);
      const existing = await sdk.getDoc(ref);
      const fields = {
        displayName: (displayName || 'Drummer').slice(0, 200),
        photoURL: photoURL ?? null,
        updatedAt: now(),
      };
      if (existing.exists()) await sdk.updateDoc(ref, fields);
      else await sdk.setDoc(ref, { ...fields, createdAt: now() });
    },

    listLessons: () => listOwned(lessons, 'name', 'asc'),
    listGrooves: () => listOwned(grooves, 'createdAt', 'asc'),

    async createLesson(name) {
      const ref = await sdk.addDoc(lessons, {
        ownerId: uid,
        name,
        createdAt: now(),
        updatedAt: now(),
      });
      return ref.id;
    },

    renameLesson: (id, name) =>
      sdk.updateDoc(sdk.doc(db, 'lessons', id), { name, updatedAt: now() }),

    // The grooves stay in the library, unfiled. Lesson delete is the last write,
    // so a failure part-way never leaves a groove that points to a missing lesson.
    // This read asks the server only: a cached list can miss grooves in the lesson, and it
    // fails offline, so the delete is refused and the error shows in the panel.
    async deleteLesson(id) {
      const snapshot = await sdk.getDocsFromServer(
        sdk.query(grooves, sdk.where('ownerId', '==', uid), sdk.where('lessonId', '==', id))
      );
      for (let start = 0; start < snapshot.docs.length; start += BATCH_LIMIT) {
        const batch = sdk.writeBatch(db);
        for (const item of snapshot.docs.slice(start, start + BATCH_LIMIT)) {
          batch.update(item.ref, { lessonId: null, updatedAt: now() });
        }
        await batch.commit();
      }
      await sdk.deleteDoc(sdk.doc(db, 'lessons', id));
    },

    async saveGroove({ query, title, lessonId }) {
      const ref = await sdk.addDoc(grooves, {
        ownerId: uid,
        lessonId: lessonId ?? null,
        title: title ?? '',
        query,
        createdAt: now(),
        updatedAt: now(),
      });
      return ref.id;
    },

    moveGroove: (id, lessonId) =>
      sdk.updateDoc(sdk.doc(db, 'grooves', id), { lessonId: lessonId ?? null, updatedAt: now() }),

    renameGroove: (id, title) =>
      sdk.updateDoc(sdk.doc(db, 'grooves', id), { title, updatedAt: now() }),

    deleteGroove: (id) => sdk.deleteDoc(sdk.doc(db, 'grooves', id)),
  };
}
