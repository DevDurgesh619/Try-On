import { describe, it, expect, vi } from 'vitest';
import { applyAdd, handleMessage, type RouterDeps } from './router';
import { MAX_REFERENCE_PHOTOS } from '@/lib/storage';
import type { GarmentSlot, PendingGarment } from '@/lib/types';

const okFetcher: RouterDeps = {
  fetchSource: vi.fn(async () => ({ data_url: 'data:image/jpeg;base64,AA', mime_type: 'image/jpeg' })),
};
const failFetcher: RouterDeps = { fetchSource: vi.fn(async () => null) };

function pg(slot: GarmentSlot, url = 'https://x/y.jpg'): PendingGarment {
  return { slot, url, origin: 'hover' };
}

function generateMsg(
  refId: string,
  garments: { slot: GarmentSlot; sourceImageUrl: string }[],
): Parameters<typeof handleMessage>[0] {
  return {
    type: 'GENERATE',
    mode: 'outfit',
    referencePhotoId: refId,
    garments,
    accessoriesMode: 'off',
  };
}

describe('applyAdd (outfit-type aware)', () => {
  it("'full': empty → adds as full", () => {
    const after = applyAdd([], pg('full', 'A'), 'full');
    expect(after).toHaveLength(1);
    expect(after[0]?.slot).toBe('full');
  });

  it("'full': second add replaces the existing one", () => {
    const after = applyAdd([pg('full', 'A')], pg('full', 'B'), 'full');
    expect(after).toHaveLength(1);
    expect(after[0]?.url).toBe('B');
  });

  it("'split': first add lands as 'top'", () => {
    const after = applyAdd([], pg('full', 'A'), 'split');
    expect(after).toHaveLength(1);
    expect(after[0]?.slot).toBe('top');
  });

  it("'split': existing top + new add becomes bottom", () => {
    const after = applyAdd([pg('top', 'T')], pg('full', 'B'), 'split');
    expect(after).toHaveLength(2);
    const byUrl = Object.fromEntries(after.map((g) => [g.url, g.slot]));
    expect(byUrl.T).toBe('top');
    expect(byUrl.B).toBe('bottom');
  });

  it("'split': existing bottom + new add becomes top", () => {
    const after = applyAdd([pg('bottom', 'B')], pg('full', 'T'), 'split');
    expect(after).toHaveLength(2);
    const byUrl = Object.fromEntries(after.map((g) => [g.url, g.slot]));
    expect(byUrl.B).toBe('bottom');
    expect(byUrl.T).toBe('top');
  });

  it("'split': 2 garments + new add replaces older keeping the pair valid", () => {
    const after = applyAdd(
      [pg('top', 'OLD'), pg('bottom', 'KEEP')],
      pg('full', 'NEW'),
      'split',
    );
    expect(after).toHaveLength(2);
    const urls = after.map((g) => g.url);
    expect(urls).toContain('KEEP');
    expect(urls).toContain('NEW');
    expect(urls).not.toContain('OLD');
    expect(after.map((g) => g.slot).sort()).toEqual(['bottom', 'top']);
  });

  it('idempotent on URL across both modes', () => {
    const a = applyAdd([pg('top', 'X')], pg('full', 'X'), 'split');
    expect(a).toHaveLength(1);
    expect(a[0]?.url).toBe('X');
  });
});

describe('router', () => {
  it('LIST_PHOTOS returns []', async () => {
    const r = await handleMessage({ type: 'LIST_PHOTOS' });
    expect(r).toEqual({ ok: true, photos: [] });
  });

  it('SAVE_PHOTO + LIST_PHOTOS round-trip', async () => {
    const saved = await handleMessage({
      type: 'SAVE_PHOTO',
      label: 'front',
      photoType: 'full_body',
      data_url: 'data:,',
    });
    expect(saved.ok).toBe(true);
    const list = await handleMessage({ type: 'LIST_PHOTOS' });
    if (list.ok && 'photos' in list) expect(list.photos).toHaveLength(1);
    else throw new Error('expected photos');
  });

  it('SAVE_PHOTO returns storage_full at the cap', async () => {
    for (let i = 0; i < MAX_REFERENCE_PHOTOS; i++) {
      await handleMessage({
        type: 'SAVE_PHOTO',
        label: `p${i}`,
        photoType: 'full_body',
        data_url: 'data:,',
      });
    }
    const r = await handleMessage({
      type: 'SAVE_PHOTO',
      label: 'overflow',
      photoType: 'full_body',
      data_url: 'data:,',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('storage_full');
  });

  it('GENERATE without a reference photo returns no_reference_photo', async () => {
    const r = await handleMessage(
      generateMsg('missing', [{ slot: 'full', sourceImageUrl: 'https://x/y.jpg' }]),
      okFetcher,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('no_reference_photo');
  });

  it('GENERATE returns a placeholder result + ms_taken', async () => {
    const saved = await handleMessage({
      type: 'SAVE_PHOTO',
      label: 'front',
      photoType: 'full_body',
      data_url: 'data:,',
    });
    if (!saved.ok || !('photo' in saved)) throw new Error('save failed');
    const r = await handleMessage(
      generateMsg(saved.photo.id, [{ slot: 'full', sourceImageUrl: 'https://x/y.jpg' }]),
      okFetcher,
    );
    expect(r.ok).toBe(true);
    if (r.ok && 'result' in r) {
      expect(r.result.full_data_url.startsWith('data:image/png')).toBe(true);
      expect(typeof r.ms_taken).toBe('number');
    }
  });

  it('GENERATE rejects 2 garments that are not top + bottom', async () => {
    const saved = await handleMessage({
      type: 'SAVE_PHOTO',
      label: 'a',
      photoType: 'full_body',
      data_url: 'data:,',
    });
    if (!saved.ok || !('photo' in saved)) throw new Error('save failed');
    const r = await handleMessage(
      generateMsg(saved.photo.id, [
        { slot: 'top', sourceImageUrl: 'https://x/a.jpg' },
        { slot: 'top', sourceImageUrl: 'https://x/b.jpg' },
      ]),
      okFetcher,
    );
    expect(r.ok).toBe(false);
  });

  it('GENERATE returns source_fetch_failed when the fetch fails', async () => {
    const saved = await handleMessage({
      type: 'SAVE_PHOTO',
      label: 'a',
      photoType: 'full_body',
      data_url: 'data:,',
    });
    if (!saved.ok || !('photo' in saved)) throw new Error('save failed');
    const r = await handleMessage(
      generateMsg(saved.photo.id, [{ slot: 'full', sourceImageUrl: 'https://x/y.jpg' }]),
      failFetcher,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('source_fetch_failed');
  });

  it('GENERATE calls backend with garments[] when use_placeholder_images is false', async () => {
    const { updateSettings } = await import('@/lib/storage');
    await updateSettings({ use_placeholder_images: false });
    const saved = await handleMessage({
      type: 'SAVE_PHOTO',
      label: 'a',
      photoType: 'full_body',
      data_url: 'data:image/jpeg;base64,REF',
    });
    if (!saved.ok || !('photo' in saved)) throw new Error('save failed');
    const fakeFetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            ok: true,
            image: 'IMG',
            mime_type: 'image/png',
            generation_id: 'g1',
            ms_taken: 100,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    );
    const r = await handleMessage(
      generateMsg(saved.photo.id, [
        { slot: 'top', sourceImageUrl: 'https://x/t.jpg' },
        { slot: 'bottom', sourceImageUrl: 'https://x/b.jpg' },
      ]),
      {
        fetchSource: vi.fn(async () => ({
          data_url: 'data:image/jpeg;base64,SRC',
          mime_type: 'image/jpeg',
        })),
        backend: { fetch: fakeFetch, baseUrl: 'http://test', retries: 0 },
      },
    );
    expect(r.ok).toBe(true);
    if (r.ok && 'result' in r) {
      expect(r.result.full_data_url.startsWith('data:image/')).toBe(true);
    }
    expect(fakeFetch).toHaveBeenCalledTimes(1);
    const calls = fakeFetch.mock.calls as unknown as [string, RequestInit][];
    const sent = JSON.parse(calls[0]?.[1].body as string) as { garments: { slot: string }[] };
    expect(sent.garments.map((g) => g.slot).sort()).toEqual(['bottom', 'top']);
  });

  it("hover SOURCE_IMAGE_SELECTED routes to accessories once a garment exists and mode='custom'", async () => {
    await handleMessage({ type: 'SET_OUTFIT_TYPE', outfitType: 'full' });
    await handleMessage({
      type: 'ADD_PENDING_GARMENT',
      garment: { slot: 'full', url: 'GARMENT', origin: 'hover' },
    });
    await handleMessage({ type: 'SET_ACCESSORIES_MODE', mode: 'custom' });
    await handleMessage({
      type: 'SOURCE_IMAGE_SELECTED',
      url: 'WATCH',
      origin: 'hover',
    });
    const r = await handleMessage({ type: 'GET_TRYON_STATE' });
    if (!r.ok || !('accessoriesMode' in r)) throw new Error('expected tryon state');
    expect(r.garments).toHaveLength(1);
    expect(r.garments[0]?.url).toBe('GARMENT');
    expect(r.accessories.map((a) => a.url)).toEqual(['WATCH']);
  });

  it("hover smart-route triggers in split mode after only 1 garment (top) when mode='custom'", async () => {
    await handleMessage({ type: 'SET_OUTFIT_TYPE', outfitType: 'split' });
    await handleMessage({
      type: 'ADD_PENDING_GARMENT',
      garment: { slot: 'top', url: 'TOP', origin: 'hover' },
    });
    await handleMessage({ type: 'SET_ACCESSORIES_MODE', mode: 'custom' });
    // Bottom slot is intentionally empty; hover-click on a watch should land
    // as an accessory, NOT as the bottom garment.
    await handleMessage({
      type: 'SOURCE_IMAGE_SELECTED',
      url: 'WATCH',
      origin: 'hover',
    });
    const r = await handleMessage({ type: 'GET_TRYON_STATE' });
    if (!r.ok || !('accessoriesMode' in r)) throw new Error('expected tryon state');
    expect(r.garments).toHaveLength(1);
    expect(r.garments[0]?.url).toBe('TOP');
    expect(r.garments[0]?.slot).toBe('top');
    expect(r.accessories.map((a) => a.url)).toEqual(['WATCH']);
  });

  it("right-click 'Try this on with TryOn' stays an explicit garment add even in custom mode", async () => {
    // Escape hatch: after top is picked and mode='custom', user can still add
    // a bottom via the right-click "Try this on" entry (origin='context_menu').
    await handleMessage({ type: 'SET_OUTFIT_TYPE', outfitType: 'split' });
    await handleMessage({
      type: 'ADD_PENDING_GARMENT',
      garment: { slot: 'top', url: 'TOP', origin: 'hover' },
    });
    await handleMessage({ type: 'SET_ACCESSORIES_MODE', mode: 'custom' });
    await handleMessage({
      type: 'SOURCE_IMAGE_SELECTED',
      url: 'BOTTOM',
      origin: 'context_menu',
    });
    const r = await handleMessage({ type: 'GET_TRYON_STATE' });
    if (!r.ok || !('accessoriesMode' in r)) throw new Error('expected tryon state');
    const byUrl = Object.fromEntries(r.garments.map((g) => [g.url, g.slot]));
    expect(byUrl.TOP).toBe('top');
    expect(byUrl.BOTTOM).toBe('bottom');
    expect(r.accessories).toEqual([]);
  });

  it("SOURCE_IMAGE_SELECTED still routes to garments when mode='off' even if garments are full", async () => {
    await handleMessage({ type: 'SET_OUTFIT_TYPE', outfitType: 'full' });
    await handleMessage({
      type: 'ADD_PENDING_GARMENT',
      garment: { slot: 'full', url: 'OLD', origin: 'hover' },
    });
    await handleMessage({ type: 'SET_ACCESSORIES_MODE', mode: 'off' });
    await handleMessage({
      type: 'SOURCE_IMAGE_SELECTED',
      url: 'NEW',
      origin: 'hover',
    });
    const r = await handleMessage({ type: 'GET_PENDING_GARMENTS' });
    if (!r.ok || !('garments' in r)) throw new Error('expected garments');
    expect(r.garments).toHaveLength(1);
    expect(r.garments[0]?.url).toBe('NEW');
  });

  it('SOURCE_IMAGE_SELECTED on default (full) outfitType lands as a single full garment', async () => {
    await handleMessage({
      type: 'SOURCE_IMAGE_SELECTED',
      url: 'https://x/y.jpg',
      origin: 'context_menu',
    });
    const r = await handleMessage({ type: 'GET_PENDING_GARMENTS' });
    if (!r.ok || !('garments' in r)) throw new Error('expected garments');
    expect(r.garments).toHaveLength(1);
    expect(r.garments[0]?.slot).toBe('full');
  });

  it("SET_OUTFIT_TYPE='split' makes subsequent adds top, then bottom", async () => {
    await handleMessage({ type: 'SET_OUTFIT_TYPE', outfitType: 'split' });
    await handleMessage({
      type: 'ADD_PENDING_GARMENT',
      garment: { slot: 'full', url: 'A', origin: 'hover' },
    });
    await handleMessage({
      type: 'ADD_PENDING_GARMENT',
      garment: { slot: 'full', url: 'B', origin: 'hover' },
    });
    const r = await handleMessage({ type: 'GET_PENDING_GARMENTS' });
    if (!r.ok || !('garments' in r)) throw new Error('expected garments');
    const byUrl = Object.fromEntries(r.garments.map((g) => [g.url, g.slot]));
    expect(byUrl.A).toBe('top');
    expect(byUrl.B).toBe('bottom');
  });

  it("switching from 'split' back to 'full' collapses to a single full garment", async () => {
    await handleMessage({ type: 'SET_OUTFIT_TYPE', outfitType: 'split' });
    await handleMessage({
      type: 'ADD_PENDING_GARMENT',
      garment: { slot: 'top', url: 'A', origin: 'hover' },
    });
    await handleMessage({
      type: 'ADD_PENDING_GARMENT',
      garment: { slot: 'bottom', url: 'B', origin: 'hover' },
    });
    await handleMessage({ type: 'SET_OUTFIT_TYPE', outfitType: 'full' });
    const r = await handleMessage({ type: 'GET_PENDING_GARMENTS' });
    if (!r.ok || !('garments' in r)) throw new Error('expected garments');
    expect(r.garments).toHaveLength(1);
    expect(r.garments[0]?.slot).toBe('full');
  });

  it('CLEAR_PENDING_GARMENTS empties the list', async () => {
    await handleMessage({
      type: 'ADD_PENDING_GARMENT',
      garment: { slot: 'top', url: 'https://x/t.jpg', origin: 'hover' },
    });
    await handleMessage({ type: 'CLEAR_PENDING_GARMENTS' });
    const r = await handleMessage({ type: 'GET_PENDING_GARMENTS' });
    if (!r.ok || !('garments' in r)) throw new Error('expected garments');
    expect(r.garments).toEqual([]);
  });

  it("SET_ACCESSORIES_MODE persists and GET_TRYON_STATE reads back", async () => {
    await handleMessage({ type: 'SET_ACCESSORIES_MODE', mode: 'model' });
    const r = await handleMessage({ type: 'GET_TRYON_STATE' });
    if (!r.ok || !('accessoriesMode' in r)) throw new Error('expected tryon state');
    expect(r.accessoriesMode).toBe('model');
    expect(r.accessories).toEqual([]);
  });

  it("ADD_PENDING_ACCESSORY appends to a list and auto-flips mode to 'custom'", async () => {
    await handleMessage({ type: 'SET_ACCESSORIES_MODE', mode: 'off' });
    await handleMessage({
      type: 'ADD_PENDING_ACCESSORY',
      accessory: { url: 'data:,A', origin: 'context_menu' },
    });
    await handleMessage({
      type: 'ADD_PENDING_ACCESSORY',
      accessory: { url: 'data:,B', origin: 'upload' },
    });
    const r = await handleMessage({ type: 'GET_TRYON_STATE' });
    if (!r.ok || !('accessoriesMode' in r)) throw new Error('expected tryon state');
    expect(r.accessoriesMode).toBe('custom');
    expect(r.accessories.map((a) => a.url)).toEqual(['data:,A', 'data:,B']);
  });

  it('ADD_PENDING_ACCESSORY is idempotent on URL', async () => {
    await handleMessage({
      type: 'ADD_PENDING_ACCESSORY',
      accessory: { url: 'data:,A', origin: 'context_menu' },
    });
    await handleMessage({
      type: 'ADD_PENDING_ACCESSORY',
      accessory: { url: 'data:,A', origin: 'upload' },
    });
    const r = await handleMessage({ type: 'GET_TRYON_STATE' });
    if (!r.ok || !('accessories' in r)) throw new Error('expected tryon state');
    expect(r.accessories).toHaveLength(1);
  });

  it("REMOVE_PENDING_ACCESSORY drops a single entry without affecting others", async () => {
    await handleMessage({
      type: 'ADD_PENDING_ACCESSORY',
      accessory: { url: 'data:,A', origin: 'context_menu' },
    });
    await handleMessage({
      type: 'ADD_PENDING_ACCESSORY',
      accessory: { url: 'data:,B', origin: 'context_menu' },
    });
    await handleMessage({ type: 'REMOVE_PENDING_ACCESSORY', index: 0 });
    const r = await handleMessage({ type: 'GET_TRYON_STATE' });
    if (!r.ok || !('accessories' in r)) throw new Error('expected tryon state');
    expect(r.accessories.map((a) => a.url)).toEqual(['data:,B']);
  });

  it("switching mode away from 'custom' clears all pending accessories", async () => {
    await handleMessage({
      type: 'ADD_PENDING_ACCESSORY',
      accessory: { url: 'data:,A', origin: 'upload' },
    });
    await handleMessage({ type: 'SET_ACCESSORIES_MODE', mode: 'off' });
    const r = await handleMessage({ type: 'GET_TRYON_STATE' });
    if (!r.ok || !('accessories' in r)) throw new Error('expected tryon state');
    expect(r.accessories).toEqual([]);
  });

  it("hair-mode GENERATE: SET_PENDING_HAIR_SOURCE round-trip + backend payload shape", async () => {
    const { updateSettings } = await import('@/lib/storage');
    await updateSettings({ use_placeholder_images: false });
    const saved = await handleMessage({
      type: 'SAVE_PHOTO',
      label: 'face',
      photoType: 'face',
      data_url: 'data:image/jpeg;base64,FACE',
    });
    if (!saved.ok || !('photo' in saved)) throw new Error('save failed');
    await handleMessage({
      type: 'SET_PENDING_HAIR_SOURCE',
      source: { url: 'https://x/cut.jpg', origin: 'context_menu' },
    });
    const state = await handleMessage({ type: 'GET_HAIR_STATE' });
    if (!state.ok || !('source' in state)) throw new Error('expected hair state');
    expect(state.source?.url).toBe('https://x/cut.jpg');

    const fakeFetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            ok: true,
            image: 'IMG',
            mime_type: 'image/png',
            generation_id: 'gh',
            ms_taken: 1,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    );
    const r = await handleMessage(
      {
        type: 'GENERATE',
        mode: 'hair',
        referencePhotoId: saved.photo.id,
        hairSourceUrl: 'https://x/cut.jpg',
      },
      {
        fetchSource: vi.fn(async () => ({
          data_url: 'data:image/jpeg;base64,SRC',
          mime_type: 'image/jpeg',
        })),
        backend: { fetch: fakeFetch, baseUrl: 'http://test', retries: 0 },
      },
    );
    expect(r.ok).toBe(true);
    expect(fakeFetch).toHaveBeenCalledTimes(1);
    const calls = fakeFetch.mock.calls as unknown as [string, RequestInit][];
    const sent = JSON.parse(calls[0]?.[1].body as string) as {
      mode: string;
      hair_source: { image: string; mime: string };
      garments?: unknown;
      accessories?: unknown;
    };
    expect(sent.mode).toBe('hair');
    expect(sent.hair_source.image).toBe('SRC');
    expect(sent.garments).toBeUndefined();
    expect(sent.accessories).toBeUndefined();
  });

  it('rejects unknown message types', async () => {
    // @ts-expect-error testing exhaustiveness at runtime
    const r = await handleMessage({ type: 'NOPE' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('unknown_message');
  });
});
