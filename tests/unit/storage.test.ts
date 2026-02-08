import { beforeEach, describe, expect, it } from 'vitest';
import { storage } from '../../src/shared/storage';
import { STORAGE_KEYS } from '../../src/shared/constants';

type Store = Record<string, any>;

function installChromeMock(initial: Store = {}): void {
  const store: Store = { ...initial };

  (globalThis as any).chrome = {
    runtime: { lastError: null },
    storage: {
      local: {
        get: (keys: any, cb: (res: any) => void) => {
          if (typeof keys === 'string') cb({ [keys]: store[keys] });
          else cb({ ...store });
        },
        set: (items: any, cb: () => void) => {
          Object.assign(store, items);
          cb();
        },
        remove: (keys: any, cb: () => void) => {
          const arr = Array.isArray(keys) ? keys : [keys];
          for (const k of arr) delete store[k];
          cb();
        },
        clear: (cb: () => void) => {
          for (const k of Object.keys(store)) delete store[k];
          cb();
        },
      },
    },
  };
}

describe('storage wrapper', () => {
  beforeEach(() => {
    installChromeMock();
  });

  it('should set and get typed values', async () => {
    await storage.set(STORAGE_KEYS.telemetryOptIn, true);
    const val = await storage.get(STORAGE_KEYS.telemetryOptIn);
    expect(val).toBe(true);
  });

  it('should remove values', async () => {
    await storage.set(STORAGE_KEYS.telemetryAsked, true);
    await storage.remove(STORAGE_KEYS.telemetryAsked);
    const val = await storage.get(STORAGE_KEYS.telemetryAsked);
    expect(val).toBeUndefined();
  });

  it('should clear values', async () => {
    await storage.set(STORAGE_KEYS.telemetryAsked, true);
    await storage.set(STORAGE_KEYS.telemetryOptIn, true);
    await storage.clear();
    expect(await storage.get(STORAGE_KEYS.telemetryAsked)).toBeUndefined();
    expect(await storage.get(STORAGE_KEYS.telemetryOptIn)).toBeUndefined();
  });
});
