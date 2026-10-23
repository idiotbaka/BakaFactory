import type { GameSave } from "./state";

export type LocalRecord = {
  developerToolsVisible?: boolean;
  viewedStories?: string[];
  pendingStories?: string[];
  owner: string;
  version: 1;
  save: GameSave | null;
  cloudVersion: number;
  cloudSavedAt: string | null;
  uploadedRevision: number | null;
  savedAt: string;
};
const DATABASE = "bakafactory-client-v1";
const STORE = "saves";
function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let abandoned = false;
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore(STORE, { keyPath: "owner" });
    request.onerror = () =>
      reject(request.error ?? new Error("无法打开本地存档"));
    request.onblocked = () => {
      abandoned = true;
      reject(new Error("本地存档升级被其他页面阻止，请关闭其他游戏页面后重试"));
    };
    request.onsuccess = () => {
      const db = request.result;
      if (abandoned) {
        db.close();
        return;
      }
      db.onversionchange = () => db.close();
      resolve(db);
    };
  });
}
async function transaction<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = action(tx.objectStore(STORE));
      // A request succeeding is insufficient: only transaction completion means
      // the complete layout + simulation + warehouse has been committed.
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = () =>
        reject(tx.error ?? request.error ?? new Error("本地存档事务被取消"));
      tx.onerror = () =>
        reject(tx.error ?? request.error ?? new Error("无法写入本地存档"));
    });
  } finally {
    db.close();
  }
}
export async function readLocal(
  owner: string,
): Promise<LocalRecord | undefined> {
  return transaction("readonly", (store) => store.get(owner));
}
export async function writeLocal(record: LocalRecord): Promise<void> {
  await transaction("readwrite", (store) => store.put(record));
}
