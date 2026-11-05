// =============================================================
//  端末内データベース（IndexedDB）
//  アプリを閉じても残る。取引・保管先・カテゴリ・画像・設定を保存
// =============================================================
const DB_NAME = 'okane-db';
const DB_VERSION = 1;
export const STORES = ['accounts', 'categories', 'txs', 'images', 'meta'];

let dbp = null;
export function openDB() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('accounts')) db.createObjectStore('accounts', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('categories')) db.createObjectStore('categories', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('txs')) db.createObjectStore('txs', { keyPath: 'id' }).createIndex('date', 'date');
      if (!db.objectStoreNames.contains('images')) db.createObjectStore('images', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => { db.close(); dbp = null; };
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('データベースを開けません（別のタブを閉じてください）'));
  });
  return dbp;
}
/** テスト用：接続を閉じる（アプリを閉じた状態の再現） */
export async function closeDB() { if (dbp) { (await dbp).close(); dbp = null; } }

function done(tx) {
  return new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error || new Error('保存が中断されました')); });
}
const wrap = (req) => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });

export async function getAll(store) {
  const db = await openDB();
  return wrap(db.transaction(store).objectStore(store).getAll());
}
export async function get(store, key) {
  const db = await openDB();
  return wrap(db.transaction(store).objectStore(store).get(key));
}
/** 複数の書き込みをまとめて1回で確定（途中で失敗したら全部取り消し） */
export async function write(ops) {
  const db = await openDB();
  const names = [...new Set(ops.map((o) => o.store))];
  const tx = db.transaction(names, 'readwrite');
  for (const o of ops) {
    const s = tx.objectStore(o.store);
    if (o.del !== undefined) s.delete(o.del); else s.put(o.value);
  }
  return done(tx);
}
export const put = (store, value) => write([{ store, value }]);
export const del = (store, key) => write([{ store, del: key }]);

export async function getMeta(key, fallback = null) {
  const r = await get('meta', key);
  return r ? r.value : fallback;
}
export const setMeta = (key, value) => put('meta', { key, value });

/** 全データを置き換え（バックアップの復元） */
export async function replaceAll(data) {
  const db = await openDB();
  const tx = db.transaction(STORES, 'readwrite');
  for (const s of STORES) tx.objectStore(s).clear();
  for (const s of STORES) for (const v of data[s] || []) tx.objectStore(s).put(v);
  return done(tx);
}
