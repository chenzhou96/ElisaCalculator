import { invoke, isTauri } from '@tauri-apps/api/core';
import type { Workspace } from './model.ts';
import { parseRecord, serializeRecord, type RestoredRecord } from './record.ts';

export interface HistoryEntry {
  id: string;
  savedAt: string;
  label: string;
  inputView: 'plate' | 'table';
  workflow: 'comparative' | 'standard_curve';
  hasResult: boolean;
  groupCount: number;
  referenceGroup: string | null;
  referenceValue: number;
  /** A damaged item remains visible and fails explicitly on recall. */
  error?: string;
}
export interface HistoryBackend {
  kind: 'native' | 'browser' | 'test';
  description: string;
  save(id: string, text: string): Promise<void>;
  list(): Promise<HistoryEntry[]>;
  read(id: string): Promise<string>;
  saveSession(text: string): Promise<void>;
  readSession(): Promise<string | null>;
}
export function validateHistoryId(id: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(id)) throw new Error('历史记录标识无效');
  return id;
}
export function historyEntry(id: string, text: string): HistoryEntry {
  validateHistoryId(id);
  const state = parseRecord(text);
  return {
    id, savedAt: state.recordSavedAt ?? '', label: state.source,
    inputView: state.inputView, workflow: state.options.workflow,
    hasResult: Boolean(state.result), groupCount: state.result?.report?.summary_rows.length ?? 0,
    referenceGroup: state.options.reference_group, referenceValue: state.options.reference_assigned_value,
  };
}
export function createNativeHistoryBackend(call: typeof invoke = invoke): HistoryBackend {
  return {
    kind: 'native',
    description: '桌面历史与会话保存在应用数据目录；原子写入后确认，独立于临时导出缓存',
    save: (id, text) => call<void>('save_history_snapshot', {id: validateHistoryId(id), text}),
    list: () => call<HistoryEntry[]>('list_history_snapshots'),
    read: id => call<string>('read_history_snapshot', {id: validateHistoryId(id)}),
    saveSession: text => call<void>('save_last_session', {text}),
    readSession: () => call<string | null>('read_last_session'),
  };
}
interface StoredSnapshot { id: string; text: string; entry: HistoryEntry }
/** IndexedDB transactions are the browser storage boundary; there is no localStorage fallback. */
export function createBrowserHistoryBackend(factory?: IDBFactory): HistoryBackend {
  const open = (): Promise<IDBDatabase> => new Promise((resolve, reject) => {
    const indexed = factory ?? globalThis.indexedDB;
    if (!indexed) {reject(new Error('此浏览器不提供 IndexedDB，无法持久保存历史')); return;}
    let active = true;
    const request = indexed.open('elisa-analysis-history', 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('snapshots')) db.createObjectStore('snapshots', {keyPath: 'id'});
      if (!db.objectStoreNames.contains('session')) db.createObjectStore('session');
    };
    request.onerror = () => {active = false; reject(request.error ?? new Error('打开浏览器历史数据库失败'));};
    request.onblocked = () => {active = false; reject(new Error('历史数据库升级被另一窗口阻塞，请关闭旧窗口后重试'));};
    request.onsuccess = () => {
      const db = request.result;
      // A blocked open may succeed later; never leak its stale connection.
      if (!active) {db.close(); return;}
      db.onversionchange = () => db.close();
      resolve(db);
    };
  });
  async function transaction<T>(store: string, mode: IDBTransactionMode, action: (store: IDBObjectStore, set: (value: T) => void, fail: (error: Error) => void) => void): Promise<T> {
    const db = await open();
    return new Promise<T>((resolve, reject) => {
      // Strict durability asks the browser to flush before completion. Failure is reported,
      // rather than silently substituting volatile storage or relaxed writes.
      let tx: IDBTransaction;
      try {tx = db.transaction(store, mode, mode === 'readwrite' ? {durability: 'strict'} : undefined);}
      catch (error) {db.close(); reject(error); return;}
      let value: T;
      let problem: Error | null = null;
      const fail = (error: Error) => {problem = error; tx.abort();};
      tx.oncomplete = () => {db.close(); resolve(value);};
      tx.onabort = () => {db.close(); reject(problem ?? tx.error ?? new Error('浏览器历史事务已回滚'));};
      tx.onerror = event => {problem ??= (event.target as IDBRequest | null)?.error ?? tx.error ?? new Error('浏览器历史事务失败');};
      if (mode === 'readwrite' && tx.durability !== 'strict') {fail(new Error('浏览器不支持严格持久化事务，无法确认写入；请使用桌面版或另存 JSON')); return;}
      try {action(tx.objectStore(store), next => {value = next;}, fail);} catch (error) {fail(error instanceof Error ? error : new Error(String(error)));}
    });
  }
  return {
    kind: 'browser',
    description: '浏览器历史保存在本机此站点的 IndexedDB；严格写入事务，清理站点数据、隐私模式或浏览器回收存储会使记录丢失，重要记录请另存 JSON',
    async save(id, text) {
      const entry = historyEntry(id, text);
      await transaction<void>('snapshots', 'readwrite', (store, set, fail) => {
        const request = store.get(id);
        request.onsuccess = () => {
          const existing = request.result as StoredSnapshot | undefined;
          if (existing) {
            if (existing.text !== text) {fail(new Error('历史记录标识已存在，不能覆盖另一份分析')); return;}
            set(undefined); return;
          }
          const count = store.count();
          count.onsuccess = () => {
            if (count.result >= 4096) {fail(new Error('历史记录已达 4096 项上限，请先备份并整理站点数据')); return;}
            store.add({id, text, entry});
            set(undefined);
          };
        };
      });
    },
    list: () => transaction<HistoryEntry[]>('snapshots', 'readonly', (store, set, fail) => {
      // Stream one full record at a time; getAll() would duplicate every embedded PNG in memory.
      const entries: HistoryEntry[] = [];
      const request = store.openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {set(entries); return;}
        if (entries.length >= 4096) {fail(new Error('历史记录超过 4096 项，请先备份并整理站点数据')); return;}
        const stored = cursor.value as Partial<StoredSnapshot> | null;
        let id = String(cursor.primaryKey);
        try {
          validateHistoryId(id);
          if (!stored || stored.id !== id || typeof stored.text !== "string") throw new Error("历史记录内容或标识已损坏");
          // Stored metadata is only a cache; rebuild it from the validated snapshot.
          entries.push(historyEntry(id, stored.text));
        } catch (error) {
          try {validateHistoryId(id);} catch {id = `damaged-item-${entries.length}`;}
          entries.push({id, savedAt: "", label: "损坏的历史记录", inputView: "plate", workflow: "comparative", hasResult: false, groupCount: 0, referenceGroup: null, referenceValue: 1, error: String(error)});
        }
        cursor.continue();
      };
    }),
    read: id => transaction<string>('snapshots', 'readonly', (store, set, fail) => {
      validateHistoryId(id);
      const request = store.get(id);
      request.onsuccess = () => {
        if (!request.result || typeof request.result.text !== 'string') {fail(new Error('历史记录不存在或已损坏')); return;}
        set(request.result.text);
      };
    }),
    saveSession: text => transaction<void>('session', 'readwrite', (store, set) => {parseRecord(text); store.put(text, 'last'); set(undefined);}),
    readSession: () => transaction<string | null>('session', 'readonly', (store, set, fail) => {
      const request = store.get('last');
      request.onsuccess = () => {
        if (request.result !== undefined && typeof request.result !== 'string') {fail(new Error('上次会话记录已损坏')); return;}
        set(request.result ?? null);
      };
    }),
  };
}
export interface HistoryService {
  readonly description: string;
  readonly kind: HistoryBackend['kind'];
  save(state: Workspace): Promise<HistoryEntry>;
  list(): Promise<HistoryEntry[]>;
  recall(id: string): Promise<RestoredRecord>;
  saveSession(state: Workspace): Promise<void>;
  restoreSession(): Promise<RestoredRecord | null>;
}
export function createHistoryService(backend: HistoryBackend, idFactory = () => `analysis-${Date.now()}-${crypto.randomUUID()}`): HistoryService {
  let writes: Promise<unknown> = Promise.resolve();
  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = writes.then(operation);
    writes = next.catch(() => undefined); // One failed write never poisons subsequent retries.
    return next;
  }
  function capture(state: Workspace): {text: string} {return {text: serializeRecord(state)};}
  const service: HistoryService = {
    description: backend.description, kind: backend.kind,
    save(state) {
      // Snapshot inputs immediately, before queued I/O; subsequent UI changes cannot leak in.
      try {
        const {text} = capture(state), id = validateHistoryId(idFactory()), entry = historyEntry(id, text);
        return enqueue(async () => {await backend.save(id, text); return entry;});
      } catch (error) {return Promise.reject(error);}
    },
    async list() {
      await writes;
      const entries = await backend.list();
      entries.forEach(entry => validateHistoryId(entry.id));
      return entries.sort((a, b) => b.savedAt.localeCompare(a.savedAt) || b.id.localeCompare(a.id));
    },
    async recall(id) {await writes; return parseRecord(await backend.read(validateHistoryId(id)));},
    saveSession(state) {
      try {const {text} = capture(state); return enqueue(() => backend.saveSession(text));}
      catch (error) {return Promise.reject(error);}
    },
    async restoreSession() {
      await writes;
      const text = await backend.readSession();
      if (text !== null) return parseRecord(text);
      const latest = (await service.list()).find(entry => !entry.error);
      return latest ? service.recall(latest.id) : null;
    },
  };
  return service;
}
export const defaultHistoryService = createHistoryService(isTauri() ? createNativeHistoryBackend() : createBrowserHistoryBackend());
