import { beforeEach, vi } from 'vitest';

interface FakeStore {
  [key: string]: unknown;
}

function makeStorageArea(): chrome.storage.StorageArea {
  let store: FakeStore = {};
  return {
    get: vi.fn((keys?: string | string[] | Record<string, unknown> | null) => {
      if (keys === null || keys === undefined) return Promise.resolve({ ...store });
      if (typeof keys === 'string') return Promise.resolve({ [keys]: store[keys] });
      if (Array.isArray(keys)) {
        const out: FakeStore = {};
        for (const k of keys) out[k] = store[k];
        return Promise.resolve(out);
      }
      const out: FakeStore = {};
      for (const k of Object.keys(keys)) out[k] = store[k] ?? (keys as FakeStore)[k];
      return Promise.resolve(out);
    }),
    set: vi.fn((items: Record<string, unknown>) => {
      store = { ...store, ...items };
      return Promise.resolve();
    }),
    remove: vi.fn((keys: string | string[]) => {
      const list = Array.isArray(keys) ? keys : [keys];
      for (const k of list) delete store[k];
      return Promise.resolve();
    }),
    clear: vi.fn(() => {
      store = {};
      return Promise.resolve();
    }),
    getBytesInUse: vi.fn(() => Promise.resolve(0)),
    setAccessLevel: vi.fn(() => Promise.resolve()),
    onChanged: { addListener: vi.fn(), removeListener: vi.fn(), hasListener: vi.fn() },
    QUOTA_BYTES: 10485760,
  } as unknown as chrome.storage.StorageArea;
}

beforeEach(() => {
  (globalThis as unknown as { chrome: typeof chrome }).chrome = {
    storage: {
      local: makeStorageArea(),
      session: makeStorageArea(),
      sync: makeStorageArea(),
    },
  } as unknown as typeof chrome;
});
