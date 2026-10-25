/**
 * Minimal promise wrapper around IndexedDB. Everything stored here stays on
 * this device: it is never uploaded or sent to the other side.
 *
 *  history  transfer/text records (keyPath "id")
 *  files    files kept for one-tap resend: handles or copies (keyPath "key")
 *  profile  name, device id, settings (out-of-line keys)
 */

export type StoreName = 'history' | 'files' | 'profile';

const DB_NAME = 'theshare';
const DB_VERSION = 1;

let opening: Promise<IDBDatabase> | null = null;

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function openDb(): Promise<IDBDatabase> {
  opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('history', { keyPath: 'id' });
      db.createObjectStore('files', { keyPath: 'key' });
      db.createObjectStore('profile');
    };
    req.onsuccess = () => {
      const db = req.result;
      // Another tab is deleting the database ("reset everything"): let it.
      db.onversionchange = () => {
        db.close();
        opening = null;
      };
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('IndexedDB blocked'));
  }).catch((e: unknown) => {
    opening = null;
    throw e;
  });
  return opening;
}

async function run<T>(store: StoreName, mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const tx = (await openDb()).transaction(store, mode);
  const result = await request(op(tx.objectStore(store)));
  if (mode === 'readwrite') {
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () => reject(tx.error);
    });
  }
  return result;
}

export const dbGet = <T>(store: StoreName, key: IDBValidKey) => run(store, 'readonly', (s) => s.get(key) as IDBRequest<T | undefined>);
export const dbGetAll = <T>(store: StoreName) => run(store, 'readonly', (s) => s.getAll() as IDBRequest<T[]>);
export const dbPut = (store: StoreName, value: unknown, key?: IDBValidKey) => run(store, 'readwrite', (s) => s.put(value, key)).then(() => {});
export const dbDelete = (store: StoreName, key: IDBValidKey) => run(store, 'readwrite', (s) => s.delete(key));
export const dbClear = (store: StoreName) => run(store, 'readwrite', (s) => s.clear());

/** Closes our connection and deletes the whole database. */
export async function deleteDb(): Promise<void> {
  const pending = opening;
  opening = null;
  if (pending) (await pending.catch(() => null))?.close();
  await request(indexedDB.deleteDatabase(DB_NAME));
}
