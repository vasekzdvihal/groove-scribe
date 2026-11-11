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

// A groove keeps its library title in its query too, as the editor writes it, so a pick and
// another device show the same name. A query without a title stays without one, and an empty
// title takes the Title out.
function withTitle(query, title) {
  if (!title) {
    return query.replace(/([?&])Title=[^&]*(&?)/, (match, start, next) => (next ? start : ''));
  }
  return query.replace(
    /([?&])Title=[^&]*/,
    (match, start) => `${start}Title=${encodeURIComponent(title)}`
  );
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
  // A new document. If the server refuses it, it is gone for good.
  const isNew = (...args) => ({ ...queued(...args), isNew: true });

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

  // Change some fields of a saved groove. createdAt stays, so the groove keeps its place. The
  // name is for the message about a refusal.
  function changeGroove(id, fields, name = fields.title) {
    return queued(
      sdk.updateDoc(sdk.doc(db, 'grooves', id), { ...fields, updatedAt: now() }),
      id,
      name,
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
      return isNew(
        sdk.setDoc(ref, { ...fields, createdAt: now(), updatedAt: now() }),
        ref.id,
        fields.name,
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
        fields.name,
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

    // A new groove is the newest, so it goes last, as in the list from the server. `query` in
    // the result is the stored query, with the title in it.
    saveGroove({ query, title, lessonId }) {
      const ref = sdk.doc(grooves);
      const cleanTitle = cleanName(title);
      const fields = {
        ownerId: uid,
        lessonId: lessonId ?? null,
        title: cleanTitle,
        query: withTitle(query, cleanTitle),
      };
      const written = isNew(
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
      return { ...written, query: fields.query };
    },

    // Replace the groove of a saved document, and file it in a lesson. createdAt stays. `query`
    // in the result is the stored query, with the title in it.
    updateGroove(id, { query, title, lessonId }) {
      const cleanTitle = cleanName(title);
      const fields = { query: withTitle(query, cleanTitle), title: cleanTitle };
      return {
        ...changeGroove(id, { ...fields, lessonId: lessonId ?? null }),
        query: fields.query,
      };
    },

    // title: the name of the groove, for the message about a refusal.
    moveGroove: (id, lessonId, title) => changeGroove(id, { lessonId: lessonId ?? null }, title),

    // query: the stored query of the groove. Its title changes too.
    renameGroove(id, title, query) {
      const cleanTitle = cleanName(title);
      return changeGroove(id, { title: cleanTitle, query: withTitle(query, cleanTitle) });
    },

    deleteGroove: (id, title) =>
      queued(sdk.deleteDoc(sdk.doc(db, 'grooves', id)), id, title, (lists) => ({
        ...lists,
        grooves: lists.grooves.filter((groove) => groove.id !== id),
      })),
  };
}
