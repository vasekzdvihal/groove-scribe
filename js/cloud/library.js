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

  // A write promise settles only when the server answers, and offline it does not settle. The
  // local cache has the change as soon as the SDK has the call, so the panel does not wait:
  // it draws from the cache and watches `committed` only to report a refusal.
  const queued = (committed, id) => ({ committed, id });

  // The cached list has the same owner filter as the server list, so another account on this
  // device never shows.
  const ownedQuery = (ref, sortField, direction) =>
    sdk.query(ref, sdk.where('ownerId', '==', uid), sdk.orderBy(sortField, direction));

  const toList = (snapshot) => ({
    items: snapshot.docs.map((item) => ({
      id: item.id,
      ...item.data(),
      hasPendingWrites: item.metadata.hasPendingWrites,
    })),
    fromCache: snapshot.metadata.fromCache,
  });

  // On a network that hangs, the SDK waits about 10 s before it answers from the cache.
  async function listOwned(ref, sortField, direction) {
    return toList(await sdk.getDocs(ownedQuery(ref, sortField, direction)));
  }

  // Answers at once and never touches the network, so the panel can draw before the server.
  async function listCached(ref, sortField, direction) {
    return toList(await sdk.getDocsFromCache(ownedQuery(ref, sortField, direction)));
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
    listCachedLessons: () => listCached(lessons, 'name', 'asc'),
    listCachedGrooves: () => listCached(grooves, 'createdAt', 'asc'),

    // Settles when the server has answered every write queued so far, also the writes of an
    // earlier visit. Offline it waits. The SDK rejects it when the user changes.
    waitForPendingWrites: () => sdk.waitForPendingWrites(db),

    // The id comes from the SDK at once, so a groove can go into a lesson that is still queued.
    createLesson(name) {
      const ref = sdk.doc(lessons);
      return queued(
        sdk.setDoc(ref, { ownerId: uid, name, createdAt: now(), updatedAt: now() }),
        ref.id
      );
    },

    renameLesson: (id, name) =>
      queued(sdk.updateDoc(sdk.doc(db, 'lessons', id), { name, updatedAt: now() })),

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

    saveGroove({ query, title, lessonId }) {
      const ref = sdk.doc(grooves);
      return queued(
        sdk.setDoc(ref, {
          ownerId: uid,
          lessonId: lessonId ?? null,
          title: title ?? '',
          query,
          createdAt: now(),
          updatedAt: now(),
        }),
        ref.id
      );
    },

    moveGroove: (id, lessonId) =>
      queued(
        sdk.updateDoc(sdk.doc(db, 'grooves', id), {
          lessonId: lessonId ?? null,
          updatedAt: now(),
        })
      ),

    renameGroove: (id, title) =>
      queued(sdk.updateDoc(sdk.doc(db, 'grooves', id), { title, updatedAt: now() })),

    deleteGroove: (id) => queued(sdk.deleteDoc(sdk.doc(db, 'grooves', id))),
  };
}
