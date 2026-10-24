/**
 * Tiny IndexedDB key-value store. Every call swallows failures (private windows,
 * blocked storage) and resolves to undefined, so callers treat it as a cache only.
 */
const DB = 'cryptodesk';
const STORE = 'kv';
let dbp: Promise<IDBDatabase | null> | null = null;

function open(): Promise<IDBDatabase | null> {
  if (dbp) return dbp;
  dbp = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbp;
}

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  return open().then(
    (db) =>
      new Promise<T | undefined>((resolve) => {
        if (!db) return resolve(undefined);
        try {
          const req = fn(db.transaction(STORE, mode).objectStore(STORE));
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(undefined);
        } catch {
          resolve(undefined);
        }
      }),
  );
}

export const kv = {
  get<T>(key: string): Promise<T | undefined> {
    return tx<T>('readonly', (s) => s.get(key) as IDBRequest<T>);
  },
  set(key: string, value: unknown): Promise<void> {
    return tx('readwrite', (s) => s.put(value, key)).then(() => undefined);
  },
  del(key: string): Promise<void> {
    return tx('readwrite', (s) => s.delete(key)).then(() => undefined);
  },
};
