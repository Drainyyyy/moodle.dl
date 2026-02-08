import type { DownloadTrackingMap } from './types';
import { STORAGE_KEYS } from './constants';
import { extAsync } from './ext';

export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS];

export interface StorageSchema {
  [STORAGE_KEYS.downloadTracking]: DownloadTrackingMap;
  [STORAGE_KEYS.telemetryAsked]: boolean;
  [STORAGE_KEYS.telemetryOptIn]: boolean;
}

/**
 * Typed Wrapper für chrome.storage.local (Promise-basiert).
 */
export const storage = {
  async get<K extends keyof StorageSchema>(key: K): Promise<StorageSchema[K] | undefined> {
    const result = await extAsync.storageLocalGet(key as string);
    return result[key as string] as StorageSchema[K] | undefined;
  },

  async set<K extends keyof StorageSchema>(key: K, value: StorageSchema[K]): Promise<void> {
    await extAsync.storageLocalSet({ [key]: value });
  },

  async remove<K extends keyof StorageSchema>(key: K): Promise<void> {
    await extAsync.storageLocalRemove(key as string);
  },

  async clear(): Promise<void> {
    await extAsync.storageLocalClear();
  },
};
