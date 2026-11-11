// Firestore access for one signed-in user: profile, lessons, and saved grooves.
// A groove is stored as its existing URL query string, the format the editor reads.

const BATCH_LIMIT = 400;
// The limit of firestore.rules for a groove title and a lesson name. A value over it would be
// queued, shown as saved, and refused at the next connection.
const NAME_LIMIT = 200;
const cleanName = (value) => (value ?? '').trim().slice(0, NAME_LIMIT);

/**
 * @typedef {{id: string, hasPendingWrites: boolean, [field: string]: unknown}} Item
 * @typedef {{lessons: Item[], grooves: Item[]}} Lists
 */

// The lists after a write, without a read: the cache has the write at once, so this is what a
// read of the cache shows. A time from the server reads as null until the server answers.
const pendingItem = (item) => ({ ...item, hasPendingWrites: true });
const editItem = (items, id, fields) =>
  items.map((item) =>
    item.id === id ? pendingItem({ ...item, ...fields, updatedAt: null }) : item
  );
// The order of the lesson list: by name, and by id for the same name.
function byName(a, b) {
  const [first, second] = a.name === b.name ? [a.id, b.id] : [String(a.name), String(b.name)];
  return first < second ? -1 : 1;
}

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
  // it draws the change with `patch`, which changes its lists as the write changed the cache,
  // and it watches `committed` only to report a refusal.
  /**
   * @param {Promise<unknown>} committed
   * @param {string} id
   * @param {string | undefined} title
   * @param {function(Lists): Lists} patch
   */
  const queued = (committed, id, title, patch) => ({ committed, id, title, patch });

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

  // Change some fields of a saved groove. createdAt stays, so the groove keeps its place.
  function changeGroove(id, fields) {
    return queued(
      sdk.updateDoc(sdk.doc(db, 'grooves', id), { ...fields, updatedAt: now() }),
      id,
      fields.title,
      (lists) => ({ ...lists, grooves: editItem(lists.grooves, id, fields) })
    );
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
      const fields = { ownerId: uid, name: cleanName(name) };
      return queued(
        sdk.setDoc(ref, { ...fields, createdAt: now(), updatedAt: now() }),
        ref.id,
        undefined,
        (lists) => ({
          ...lists,
          lessons: [
            ...lists.lessons,
            pendingItem({ id: ref.id, ...fields, createdAt: null, updatedAt: null }),
          ].sort(byName),
        })
      );
    },

    renameLesson(id, name) {
      const fields = { name: cleanName(name) };
      return queued(
        sdk.updateDoc(sdk.doc(db, 'lessons', id), { ...fields, updatedAt: now() }),
        id,
        undefined,
        (lists) => ({ ...lists, lessons: editItem(lists.lessons, id, fields).sort(byName) })
      );
    },

    // The grooves stay in the library, unfiled. Lesson delete is the last write,
    // so a failure part-way never leaves a groove that points to a missing lesson.
    // This read asks the server only: a cached list can miss grooves in the lesson, and it
    // fails offline, so the delete is refused and the error shows in the panel. It returns when
    // the server has the change, so `committed` has nothing left to wait for.
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
      const moved = new Set(snapshot.docs.map((item) => item.id));
      return queued(Promise.resolve(), id, undefined, (lists) => ({
        lessons: lists.lessons.filter((lesson) => lesson.id !== id),
        grooves: lists.grooves.map((groove) =>
          moved.has(groove.id) ? { ...groove, lessonId: null } : groove
        ),
      }));
    },

    // A new groove is the newest, so it goes last, as in the list from the server.
    saveGroove({ query, title, lessonId }) {
      const ref = sdk.doc(grooves);
      const fields = { ownerId: uid, lessonId: lessonId ?? null, title: cleanName(title), query };
      return queued(
        sdk.setDoc(ref, { ...fields, createdAt: now(), updatedAt: now() }),
        ref.id,
        fields.title,
        (lists) => ({
          ...lists,
          grooves: [
            ...lists.grooves,
            pendingItem({ id: ref.id, ...fields, createdAt: null, updatedAt: null }),
          ],
        })
      );
    },

    // Replace the groove of a saved document, and file it in a lesson. createdAt stays.
    updateGroove(id, { query, title, lessonId }) {
      return changeGroove(id, { query, title: cleanName(title), lessonId: lessonId ?? null });
    },

    moveGroove: (id, lessonId) => changeGroove(id, { lessonId: lessonId ?? null }),

    renameGroove: (id, title) => changeGroove(id, { title: cleanName(title) }),

    deleteGroove: (id) =>
      queued(sdk.deleteDoc(sdk.doc(db, 'grooves', id)), id, undefined, (lists) => ({
        ...lists,
        grooves: lists.grooves.filter((groove) => groove.id !== id),
      })),
  };
}
