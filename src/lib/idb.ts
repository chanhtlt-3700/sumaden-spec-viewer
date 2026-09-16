import type { Spec, SpecIndex } from '../types';

/**
 * A snapshot the browser built for itself, kept in IndexedDB.
 *
 * Only used when there is no `public/data` to read — a few MB of parsed specs
 * is far past what localStorage can hold, and re-downloading 63 files on every
 * reload would make a cold start feel broken.
 */

const DB_NAME = 'spec-view';
const DB_VERSION = 1;
const STORE = 'snapshot';
const KEY = 'current';

export interface StoredSnapshot {
  index: SpecIndex;
  specs: Spec[];
  savedAt: number;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Không mở được IndexedDB'));
  });
}

function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = fn(tx.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error('Lỗi IndexedDB'));
        tx.oncomplete = () => db.close();
      })
  );
}

export async function readSnapshot(): Promise<StoredSnapshot | null> {
  try {
    return (await run<StoredSnapshot | undefined>('readonly', (s) => s.get(KEY))) ?? null;
  } catch {
    // Private mode, blocked storage, corrupt DB — fall back to a fresh build.
    return null;
  }
}

export async function writeSnapshot(index: SpecIndex, specs: Spec[]): Promise<boolean> {
  try {
    await run('readwrite', (s) => s.put({ index, specs, savedAt: Date.now() }, KEY));
    return true;
  } catch {
    return false;
  }
}

export async function clearSnapshot(): Promise<void> {
  try {
    await run('readwrite', (s) => s.delete(KEY));
  } catch {
    /* nothing cached */
  }
}
