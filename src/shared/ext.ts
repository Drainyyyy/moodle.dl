import { getExtApi } from './utils';

/**
 * Minimaler Promise-Wrapper für callback-basierte Chrome APIs.
 * Funktioniert in Chrome und Firefox, da Firefox ebenfalls `chrome.*` bereitstellt.
 */
export function promisifyChrome<T>(fn: (cb: (result: T) => void) => void): Promise<T> {
  const ext = getExtApi();
  return new Promise<T>((resolve, reject) => {
    fn((result) => {
      const err = ext.runtime?.lastError;
      if (err) reject(new Error(err.message));
      else resolve(result);
    });
  });
}

export function promisifyChromeVoid(fn: (cb: () => void) => void): Promise<void> {
  const ext = getExtApi();
  return new Promise<void>((resolve, reject) => {
    fn(() => {
      const err = ext.runtime?.lastError;
      if (err) reject(new Error(err.message));
      else resolve();
    });
  });
}

export const extAsync = {
  tabsQuery(queryInfo: chrome.tabs.QueryInfo): Promise<chrome.tabs.Tab[]> {
    const ext = getExtApi();
    return promisifyChrome((cb) => ext.tabs.query(queryInfo, cb));
  },

  tabsSendMessage<TResponse = any>(tabId: number, message: any): Promise<TResponse> {
    const ext = getExtApi();
    return promisifyChrome((cb) => ext.tabs.sendMessage(tabId, message, cb));
  },

  runtimeSendMessage<TResponse = any>(message: any): Promise<TResponse> {
    const ext = getExtApi();
    return promisifyChrome((cb) => ext.runtime.sendMessage(message, cb));
  },

  storageLocalGet(keys: string | string[] | object | null): Promise<Record<string, any>> {
    const ext = getExtApi();
    return promisifyChrome((cb) => ext.storage.local.get(keys as any, cb));
  },

  storageLocalSet(items: Record<string, any>): Promise<void> {
    const ext = getExtApi();
    return promisifyChromeVoid((cb) => ext.storage.local.set(items as any, cb));
  },

  storageLocalRemove(keys: string | string[]): Promise<void> {
    const ext = getExtApi();
    return promisifyChromeVoid((cb) => ext.storage.local.remove(keys as any, cb));
  },

  storageLocalClear(): Promise<void> {
    const ext = getExtApi();
    return promisifyChromeVoid((cb) => ext.storage.local.clear(cb));
  },

  downloadsDownload(options: chrome.downloads.DownloadOptions): Promise<number> {
    const ext = getExtApi();
    return promisifyChrome((cb) => ext.downloads.download(options, cb));
  },
};
