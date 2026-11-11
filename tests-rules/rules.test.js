import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore';

let env;
const OLD = Timestamp.fromDate(new Date('2020-01-01'));
const db = (uid) =>
  (uid ? env.authenticatedContext(uid) : env.unauthenticatedContext()).firestore();

const lessonData = (ownerId, extra = {}) => ({
  ownerId,
  name: 'Week 1',
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
  ...extra,
});

const grooveData = (ownerId, extra = {}) => ({
  ownerId,
  lessonId: null,
  title: 'Beat',
  query: '?H=|x-|',
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
  ...extra,
});

async function seed(path, data) {
  await env.withSecurityRulesDisabled((context) =>
    setDoc(doc(context.firestore(), path), { createdAt: OLD, updatedAt: OLD, ...data })
  );
}

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-groovescribe',
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  });
});
afterAll(() => env.cleanup());
// Only accounts listed in allowedUsers can use the library. The unlisted uid stays out.
const ALLOWED = ['ana', 'bob'];
const UNLISTED = 'eve';
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (context) => {
    for (const uid of ALLOWED) await setDoc(doc(context.firestore(), 'allowedUsers', uid), {});
  });
});

describe('allowlist', () => {
  it('lets a listed user read their lesson and blocks an unlisted one', async () => {
    await seed('lessons/one', { ownerId: 'ana', name: 'Week 1' });
    await seed('lessons/eve', { ownerId: UNLISTED, name: 'Week 1' });
    await assertSucceeds(getDoc(doc(db('ana'), 'lessons/one')));
    await assertFails(getDoc(doc(db(UNLISTED), 'lessons/eve')));
    await assertFails(addDoc(collection(db(UNLISTED), 'lessons'), lessonData(UNLISTED)));
    await assertFails(
      setDoc(doc(db(UNLISTED), 'users/eve'), {
        displayName: 'Eve',
        photoURL: null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
  });

  it('lets no client read or write the list', async () => {
    for (const uid of ['ana', UNLISTED, null]) {
      await assertFails(getDoc(doc(db(uid), 'allowedUsers/ana')));
      await assertFails(setDoc(doc(db(uid), 'allowedUsers/' + (uid ?? 'anon')), {}));
      await assertFails(deleteDoc(doc(db(uid), 'allowedUsers/ana')));
    }
  });
});

describe('users', () => {
  const profile = () => ({
    displayName: 'Ana',
    photoURL: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  it('lets a user create and read their own profile', async () => {
    await assertSucceeds(setDoc(doc(db('ana'), 'users/ana'), profile()));
    await assertSucceeds(getDoc(doc(db('ana'), 'users/ana')));
  });

  it('blocks other users and anonymous callers', async () => {
    await seed('users/ana', { displayName: 'Ana' });
    await assertFails(getDoc(doc(db('bob'), 'users/ana')));
    await assertFails(getDoc(doc(db(null), 'users/ana')));
    await assertFails(setDoc(doc(db('bob'), 'users/ana'), profile()));
  });

  it('rejects unknown fields and createdAt changes', async () => {
    await assertFails(setDoc(doc(db('ana'), 'users/ana'), { ...profile(), admin: true }));
    await seed('users/ana', { displayName: 'Ana' });
    await assertFails(
      updateDoc(doc(db('ana'), 'users/ana'), {
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
  });
});

describe('lessons', () => {
  it('lets an owner create, list, rename, and delete', async () => {
    const ana = db('ana');
    const ref = await assertSucceeds(addDoc(collection(ana, 'lessons'), lessonData('ana')));
    await assertSucceeds(getDocs(query(collection(ana, 'lessons'), where('ownerId', '==', 'ana'))));
    await assertSucceeds(updateDoc(ref, { name: 'Week 2', updatedAt: serverTimestamp() }));
    await assertSucceeds(deleteDoc(ref));
  });

  it('blocks creating a lesson for someone else', async () => {
    await assertFails(addDoc(collection(db('bob'), 'lessons'), lessonData('ana')));
  });

  it('blocks reading, listing, changing, and deleting another user lesson', async () => {
    await seed('lessons/one', { ownerId: 'ana', name: 'Week 1' });
    const bob = db('bob');
    await assertFails(getDoc(doc(bob, 'lessons/one')));
    await assertFails(getDocs(collection(bob, 'lessons')));
    await assertFails(getDocs(query(collection(bob, 'lessons'), where('ownerId', '==', 'ana'))));
    await assertFails(
      updateDoc(doc(bob, 'lessons/one'), { name: 'x', updatedAt: serverTimestamp() })
    );
    await assertFails(deleteDoc(doc(bob, 'lessons/one')));
  });

  it('blocks giving a lesson away', async () => {
    await seed('lessons/one', { ownerId: 'ana', name: 'Week 1' });
    await assertFails(
      updateDoc(doc(db('ana'), 'lessons/one'), { ownerId: 'bob', updatedAt: serverTimestamp() })
    );
  });

  it('rejects empty and over-long names', async () => {
    const lessons = collection(db('ana'), 'lessons');
    await assertFails(addDoc(lessons, lessonData('ana', { name: '' })));
    await assertFails(addDoc(lessons, lessonData('ana', { name: 'x'.repeat(201) })));
  });
});

describe('grooves', () => {
  it('lets an owner save to no lesson and to their own lesson', async () => {
    await seed('lessons/one', { ownerId: 'ana', name: 'Week 1' });
    const grooves = collection(db('ana'), 'grooves');
    await assertSucceeds(addDoc(grooves, grooveData('ana')));
    await assertSucceeds(addDoc(grooves, grooveData('ana', { lessonId: 'one' })));
  });

  it('lets an owner rename a groove after its lesson is gone', async () => {
    await seed('grooves/g', { ownerId: 'ana', lessonId: 'gone', title: 'Beat', query: '?H=|x|' });
    await assertSucceeds(
      updateDoc(doc(db('ana'), 'grooves/g'), { title: 'Renamed', updatedAt: serverTimestamp() })
    );
  });

  describe('updating the query and title', () => {
    const update = (uid, fields) =>
      updateDoc(doc(db(uid), 'grooves/g'), {
        query: '?H=|xx|',
        title: 'Beat 2',
        updatedAt: serverTimestamp(),
        ...fields,
      });

    beforeEach(() =>
      seed('grooves/g', { ownerId: 'ana', lessonId: null, title: 'Beat', query: '?H=|x|' })
    );

    it('lets the owner update a groove', async () => {
      await assertSucceeds(update('ana'));
    });

    it('blocks another user', async () => {
      await assertFails(update('bob'));
      await assertFails(update(null));
    });

    it('blocks a change of ownerId or createdAt', async () => {
      await assertFails(update('ana', { ownerId: 'bob' }));
      await assertFails(update('ana', { createdAt: serverTimestamp() }));
    });

    it('rejects an invalid query, title or timestamp', async () => {
      await assertFails(update('ana', { query: 'H=|xx|' }));
      await assertFails(update('ana', { query: '?' + 'x'.repeat(8000) }));
      await assertFails(update('ana', { title: 'x'.repeat(201) }));
      await assertFails(update('ana', { updatedAt: OLD }));
    });

    it('rejects an extra key and a title that is not a string', async () => {
      await assertFails(update('ana', { extra: 1 }));
      await assertFails(update('ana', { title: 5 }));
    });
  });

  it('blocks moving a groove into a missing or foreign lesson', async () => {
    await seed('lessons/theirs', { ownerId: 'bob', name: 'Week 1' });
    await seed('grooves/g', { ownerId: 'ana', lessonId: null, title: 'Beat', query: '?H=|x|' });
    const ref = doc(db('ana'), 'grooves/g');
    await assertFails(updateDoc(ref, { lessonId: 'missing', updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(ref, { lessonId: 'theirs', updatedAt: serverTimestamp() }));
  });

  it('blocks filing a groove in another user lesson', async () => {
    await seed('lessons/one', { ownerId: 'ana', name: 'Week 1' });
    await assertFails(
      addDoc(collection(db('bob'), 'grooves'), grooveData('bob', { lessonId: 'one' }))
    );
  });

  it('blocks another user from every operation', async () => {
    await seed('grooves/g', { ownerId: 'ana', lessonId: null, title: 'Beat', query: '?H=|x|' });
    const bob = db('bob');
    await assertFails(getDoc(doc(bob, 'grooves/g')));
    await assertFails(
      updateDoc(doc(bob, 'grooves/g'), { title: 'x', updatedAt: serverTimestamp() })
    );
    await assertFails(deleteDoc(doc(bob, 'grooves/g')));
    await assertFails(getDoc(doc(db(null), 'grooves/g')));
  });

  it('rejects malformed queries and extra fields', async () => {
    const grooves = collection(db('ana'), 'grooves');
    await assertFails(addDoc(grooves, grooveData('ana', { query: 'H=|x|' })));
    await assertFails(addDoc(grooves, grooveData('ana', { query: '?' + 'x'.repeat(8000) })));
    await assertFails(addDoc(grooves, grooveData('ana', { extra: 1 })));
  });

  it('rejects client-chosen timestamps', async () => {
    await assertFails(
      addDoc(collection(db('ana'), 'grooves'), grooveData('ana', { updatedAt: OLD }))
    );
  });
});
