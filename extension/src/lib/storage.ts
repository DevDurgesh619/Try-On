import type {
  ReferencePhoto,
  ReferencePhotoType,
  RecentResult,
  Settings,
  StorageShape,
} from './types';
import { uuidv4 } from './uuid';

export const MAX_REFERENCE_PHOTOS = 4;
export const MAX_RECENT_RESULTS = 20;

const DEFAULT_SETTINGS: Settings = {
  use_placeholder_images: true,
};

type StorageArea = Pick<chrome.storage.StorageArea, 'get' | 'set'>;

function area(): StorageArea {
  return chrome.storage.local;
}

async function readKey<K extends keyof StorageShape>(key: K): Promise<StorageShape[K] | undefined> {
  const out = await area().get(key);
  return out[key] as StorageShape[K] | undefined;
}

async function writeKey<K extends keyof StorageShape>(key: K, value: StorageShape[K]): Promise<void> {
  await area().set({ [key]: value });
}

// ---------- Reference photos ----------

export async function listReferencePhotos(): Promise<ReferencePhoto[]> {
  return (await readKey('reference_photos')) ?? [];
}

export interface SavePhotoInput {
  label: string;
  type: ReferencePhotoType;
  data_url: string;
}

export class StorageFullError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageFullError';
  }
}

export async function saveReferencePhoto(input: SavePhotoInput): Promise<ReferencePhoto> {
  const photos = await listReferencePhotos();
  if (photos.length >= MAX_REFERENCE_PHOTOS) {
    throw new StorageFullError(`max ${MAX_REFERENCE_PHOTOS} reference photos`);
  }
  const photo: ReferencePhoto = {
    id: uuidv4(),
    label: input.label,
    type: input.type,
    data_url: input.data_url,
    created_at: Date.now(),
  };
  await writeKey('reference_photos', [...photos, photo]);
  return photo;
}

export async function deleteReferencePhoto(id: string): Promise<void> {
  const photos = await listReferencePhotos();
  await writeKey(
    'reference_photos',
    photos.filter((p) => p.id !== id),
  );
}

// ---------- Recent results (FIFO, capped) ----------

export async function listRecentResults(): Promise<RecentResult[]> {
  return (await readKey('recent_results')) ?? [];
}

export async function addRecentResult(result: RecentResult): Promise<RecentResult[]> {
  const existing = await listRecentResults();
  let candidates = [result, ...existing].slice(0, MAX_RECENT_RESULTS);
  // chrome.storage.local has a hard 10MB quota. If a single oversized result
  // pushes us over, drop the oldest ones until the write succeeds. Worst case
  // we end up with just the new result.
  for (;;) {
    try {
      await writeKey('recent_results', candidates);
      return candidates;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!/quota/i.test(msg) || candidates.length <= 1) throw e;
      candidates = candidates.slice(0, -1);
    }
  }
}

// ---------- Settings ----------

export async function getSettings(): Promise<Settings> {
  return { ...DEFAULT_SETTINGS, ...((await readKey('settings')) ?? {}) };
}

export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  const next: Settings = { ...(await getSettings()), ...patch };
  await writeKey('settings', next);
  return next;
}
