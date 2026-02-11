/**
 * Minimaler IndexedDB-Wrapper zum Persistieren von File System Access Handles.
 *
 * Hinweis: `chrome.storage` kann Handles nicht speichern (JSON-serialisiert).
 * In Chromium sind FileSystemHandles structured-clonebar und können in IDB liegen.
 */

const DB_NAME = 'moodle.download';
const DB_VERSION = 1;
const STORE = 'handles';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'key' });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Failed to open IndexedDB'));
  });
}

export async function idbSetHandle<T>(key: string, handle: T): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    store.put({ key, handle });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Failed to write to IndexedDB'));
  });
  db.close();
}

export async function idbGetHandle<T>(key: string): Promise<T | undefined> {
  const db = await openDb();
  const handle = await new Promise<T | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const store = tx.objectStore(STORE);
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result?.handle as T | undefined);
    req.onerror = () => reject(req.error || new Error('Failed to read from IndexedDB'));
  });
  db.close();
  return handle;
}

export async function idbDeleteHandle(key: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    store.delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Failed to delete from IndexedDB'));
  });
  db.close();
}
