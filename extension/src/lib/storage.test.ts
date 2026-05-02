import { describe, it, expect } from 'vitest';
import {
  MAX_RECENT_RESULTS,
  MAX_REFERENCE_PHOTOS,
  StorageFullError,
  addRecentResult,
  deleteReferencePhoto,
  getSettings,
  listRecentResults,
  listReferencePhotos,
  saveReferencePhoto,
  updateSettings,
} from './storage';
import type { RecentResult } from './types';

function fakeResult(id: string): RecentResult {
  return {
    id,
    mode: 'outfit',
    thumbnail_data_url: 'data:image/png;base64,AA',
    full_data_url: 'data:image/png;base64,AA',
    created_at: Date.now(),
  };
}

describe('reference photos', () => {
  it('starts empty', async () => {
    expect(await listReferencePhotos()).toEqual([]);
  });

  it('saves and lists photos', async () => {
    const p = await saveReferencePhoto({ label: 'front', type: 'full_body', data_url: 'data:,' });
    const all = await listReferencePhotos();
    expect(all).toHaveLength(1);
    expect(all[0]?.id).toBe(p.id);
    expect(all[0]?.label).toBe('front');
  });

  it(`enforces MAX_REFERENCE_PHOTOS = ${MAX_REFERENCE_PHOTOS}`, async () => {
    for (let i = 0; i < MAX_REFERENCE_PHOTOS; i++) {
      await saveReferencePhoto({ label: `p${i}`, type: 'full_body', data_url: 'data:,' });
    }
    await expect(
      saveReferencePhoto({ label: 'overflow', type: 'full_body', data_url: 'data:,' }),
    ).rejects.toBeInstanceOf(StorageFullError);
  });

  it('deletes by id', async () => {
    const a = await saveReferencePhoto({ label: 'a', type: 'face', data_url: 'data:,' });
    await saveReferencePhoto({ label: 'b', type: 'face', data_url: 'data:,' });
    await deleteReferencePhoto(a.id);
    const remaining = await listReferencePhotos();
    expect(remaining.map((p) => p.label)).toEqual(['b']);
  });
});

describe('recent results', () => {
  it('caps at MAX_RECENT_RESULTS, FIFO newest-first', async () => {
    for (let i = 0; i < MAX_RECENT_RESULTS + 3; i++) {
      await addRecentResult(fakeResult(`r${i}`));
    }
    const all = await listRecentResults();
    expect(all).toHaveLength(MAX_RECENT_RESULTS);
    expect(all[0]?.id).toBe(`r${MAX_RECENT_RESULTS + 2}`);
  });
});

describe('settings', () => {
  it('defaults use_placeholder_images = true', async () => {
    const s = await getSettings();
    expect(s.use_placeholder_images).toBe(true);
  });

  it('merges patches', async () => {
    const s = await updateSettings({ use_placeholder_images: false });
    expect(s.use_placeholder_images).toBe(false);
    expect((await getSettings()).use_placeholder_images).toBe(false);
  });
});
