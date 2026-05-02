import {
  deleteReferencePhoto,
  listReferencePhotos,
  saveReferencePhoto,
  addRecentResult,
  getSettings,
  StorageFullError,
} from '@/lib/storage';
import { makePlaceholderResult } from '@/lib/placeholder';
import { uuidv4 } from '@/lib/uuid';
import { getOrCreateDeviceId } from '@/lib/device-id';
import { compressBlob } from '@/lib/image';
import { callGenerate, type BackendDeps, type BackendGarment } from './backend';
import type {
  AccessoriesMode,
  ErrorResponse,
  GarmentSlot,
  Message,
  MessageResponse,
  OutfitType,
  PendingAccessory,
  PendingGarment,
  PendingHairSource,
} from '@/lib/types';

const PENDING_KEY = 'pending_garments';
const ACCESSORIES_KEY = 'pending_accessories';
const ACCESSORIES_MODE_KEY = 'accessories_mode';
const OUTFIT_TYPE_KEY = 'outfit_type';
const HAIR_SOURCE_KEY = 'pending_hair_source';

function err(code: ErrorResponse['code'], message: string): ErrorResponse {
  return { ok: false, code, message };
}

interface SourceFetcher {
  (url: string): Promise<{ data_url: string; mime_type: string } | null>;
}

const defaultFetchSource: SourceFetcher = async (url) => {
  try {
    const res = await fetch(url, { credentials: 'omit' });
    if (!res.ok) return null;
    const raw = await res.blob();
    const compressed = await compressBlob(raw).catch(() => null);
    const out = compressed?.blob ?? raw;
    const data_url = await blobToDataUrl(out);
    return { data_url, mime_type: out.type || 'image/jpeg' };
  } catch {
    return null;
  }
};

function base64ToBlob(b64: string, mime: string): Promise<Blob> {
  return fetch(`data:${mime};base64,${b64}`).then((r) => r.blob());
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = (): void => resolve(String(r.result));
    r.onerror = (): void => reject(new Error('blob_read_failed'));
    r.readAsDataURL(blob);
  });
}

function splitDataUrl(dataUrl: string): { mime: string; b64: string } {
  const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!m) return { mime: 'image/jpeg', b64: dataUrl };
  return { mime: m[1] ?? 'image/jpeg', b64: m[2] ?? '' };
}

// ---------- session-storage helpers ----------

async function readPending(): Promise<PendingGarment[]> {
  const out = await chrome.storage.session.get(PENDING_KEY);
  const v = out[PENDING_KEY];
  return Array.isArray(v) ? (v as PendingGarment[]) : [];
}

async function writePending(garments: PendingGarment[]): Promise<void> {
  await chrome.storage.session.set({ [PENDING_KEY]: garments });
}

async function readOutfitType(): Promise<OutfitType> {
  const out = await chrome.storage.session.get(OUTFIT_TYPE_KEY);
  const v = out[OUTFIT_TYPE_KEY];
  return v === 'split' ? 'split' : 'full';
}

async function writeOutfitType(t: OutfitType): Promise<void> {
  await chrome.storage.session.set({ [OUTFIT_TYPE_KEY]: t });
}

async function readAccessoriesMode(): Promise<AccessoriesMode> {
  const out = await chrome.storage.session.get(ACCESSORIES_MODE_KEY);
  const v = out[ACCESSORIES_MODE_KEY];
  return v === 'model' || v === 'custom' ? v : 'off';
}

async function readPendingAccessories(): Promise<PendingAccessory[]> {
  const out = await chrome.storage.session.get(ACCESSORIES_KEY);
  const v = out[ACCESSORIES_KEY];
  return Array.isArray(v) ? (v as PendingAccessory[]) : [];
}

async function writePendingAccessories(list: PendingAccessory[]): Promise<void> {
  await chrome.storage.session.set({ [ACCESSORIES_KEY]: list });
}

// ---------- garment slot logic ----------

/**
 * Outfit-type-aware add. The garments-strip rule depends on the user's
 * up-front choice:
 *
 * - 'full': there is at most ONE garment, and it always carries slot 'full'.
 *   Adding a new image replaces the existing one. The user explicitly chose
 *   "Full body outfit", so a second add overwrites rather than auto-pairing.
 *
 * - 'split': the user wants top + bottom from separate sources.
 *   • Empty           → first add lands as 'top' (the natural first pick).
 *   • Has 1 'top'     → next add lands as 'bottom'.
 *   • Has 1 'bottom'  → next add lands as 'top'.
 *   • Has top + bottom → newest stays, the older opposite-slot is replaced.
 *
 * Idempotent on URL across both modes.
 */
export function applyAdd(
  existing: PendingGarment[],
  incoming: PendingGarment,
  outfitType: OutfitType,
): PendingGarment[] {
  const sameIdx = existing.findIndex((g) => g.url === incoming.url);
  if (sameIdx >= 0) {
    const next = existing.slice();
    next[sameIdx] = { ...incoming, slot: existing[sameIdx]?.slot ?? incoming.slot };
    return next;
  }

  if (outfitType === 'full') {
    return [{ ...incoming, slot: 'full' }];
  }

  // outfitType === 'split'
  if (existing.length === 0) {
    return [{ ...incoming, slot: 'top' }];
  }
  if (existing.length === 1) {
    const e = existing[0];
    if (!e) return [{ ...incoming, slot: 'top' }];
    const eSlot: GarmentSlot = e.slot === 'bottom' ? 'bottom' : 'top';
    const newSlot: GarmentSlot = eSlot === 'top' ? 'bottom' : 'top';
    return [
      { ...e, slot: eSlot },
      { ...incoming, slot: newSlot },
    ];
  }
  // 2 garments — keep the newer, replace the older.
  const keeper = existing[existing.length - 1];
  if (!keeper) return [{ ...incoming, slot: 'top' }];
  const keeperSlot: GarmentSlot = keeper.slot === 'bottom' ? 'bottom' : 'top';
  const newSlot: GarmentSlot = keeperSlot === 'top' ? 'bottom' : 'top';
  return [
    { ...keeper, slot: keeperSlot },
    { ...incoming, slot: newSlot },
  ];
}

/** Applied when the user switches outfitType. Keeps existing thumbnails when possible. */
function reconcileGarments(
  existing: PendingGarment[],
  newType: OutfitType,
): PendingGarment[] {
  if (newType === 'full') {
    const first = existing[0];
    return first ? [{ ...first, slot: 'full' }] : [];
  }
  // split
  if (existing.length === 0) return [];
  if (existing.length === 1) {
    const e = existing[0];
    if (!e) return [];
    return [{ ...e, slot: e.slot === 'bottom' ? 'bottom' : 'top' }];
  }
  const top = existing.find((g) => g.slot === 'top') ?? existing[0];
  const bottom = existing.find((g) => g.slot === 'bottom') ?? existing[1];
  if (!top || !bottom) return [];
  return [
    { ...top, slot: 'top' },
    { ...bottom, slot: 'bottom' },
  ];
}

// ---------- garments validation (mirror of backend) ----------

function validateGarments(g: { slot: GarmentSlot; sourceImageUrl: string }[]): boolean {
  if (g.length === 1) return true;
  if (g.length !== 2) return false;
  const sorted = g.map((x) => x.slot).sort().join(',');
  return sorted === 'bottom,top';
}

// ---------- router ----------

export interface RouterDeps {
  fetchSource: SourceFetcher;
  backend?: BackendDeps;
}

export const defaultDeps: RouterDeps = { fetchSource: defaultFetchSource };

export async function handleMessage(
  msg: Message,
  deps: RouterDeps = defaultDeps,
): Promise<MessageResponse> {
  switch (msg.type) {
    case 'LIST_PHOTOS':
      return { ok: true, photos: await listReferencePhotos() };

    case 'SAVE_PHOTO': {
      try {
        const photo = await saveReferencePhoto({
          label: msg.label,
          type: msg.photoType,
          data_url: msg.data_url,
        });
        return { ok: true, photo };
      } catch (e) {
        if (e instanceof StorageFullError) return err('storage_full', e.message);
        throw e;
      }
    }

    case 'DELETE_PHOTO':
      await deleteReferencePhoto(msg.id);
      return { ok: true };

    case 'GENERATE': {
      const photos = await listReferencePhotos();
      const ref = photos.find((p) => p.id === msg.referencePhotoId);
      if (!ref) return err('no_reference_photo', 'Reference photo not found');

      const t0 = Date.now();
      const settings = await getSettings();
      let full_data_url: string;
      let thumbnail_data_url: string;

      if (msg.mode === 'outfit') {
        if (!validateGarments(msg.garments)) {
          return err('source_fetch_failed', 'Pick one outfit, or one top + one bottom.');
        }
        const fetched: { slot: GarmentSlot; data_url: string; mime_type: string }[] = [];
        for (const g of msg.garments) {
          const f = await deps.fetchSource(g.sourceImageUrl);
          if (!f) {
            return err(
              'source_fetch_failed',
              "Couldn't load that image — try right-clicking it instead",
            );
          }
          fetched.push({ slot: g.slot, ...f });
        }

        if (settings.use_placeholder_images) {
          const ph = makePlaceholderResult();
          full_data_url = ph.full_data_url;
          thumbnail_data_url = ph.thumbnail_data_url;
        } else {
          const refSplit = splitDataUrl(ref.data_url);
          const deviceId = await getOrCreateDeviceId();
          const garments: BackendGarment[] = fetched.map((f) => {
            const s = splitDataUrl(f.data_url);
            return { slot: f.slot, image_b64: s.b64, mime: f.mime_type || s.mime };
          });

          let accessories: { image_b64: string; mime: string }[] | undefined;
          if (msg.accessoriesMode === 'custom') {
            const urls = msg.accessoryUrls ?? [];
            if (urls.length === 0) {
              return err('source_fetch_failed', 'Add at least one accessory image first.');
            }
            accessories = [];
            for (const url of urls) {
              const af = await deps.fetchSource(url);
              if (!af) {
                return err('source_fetch_failed', "Couldn't load an accessory image.");
              }
              const s = splitDataUrl(af.data_url);
              accessories.push({ image_b64: s.b64, mime: af.mime_type || s.mime });
            }
          }

          const live = await callGenerate(
            {
              mode: 'outfit',
              device_id: deviceId,
              reference_photo_b64: refSplit.b64,
              reference_mime: refSplit.mime,
              garments,
              accessoriesMode: msg.accessoriesMode,
              ...(accessories ? { accessories } : {}),
            },
            deps.backend,
          );
          if (!live.ok) return err(live.code, live.message);
          const fullBlob = await base64ToBlob(live.image_b64, live.mime_type);
          const fullCompressed = await compressBlob(fullBlob, 1024, 0.85).catch(() => null);
          const thumbCompressed = await compressBlob(fullBlob, 256, 0.8).catch(() => null);
          full_data_url = await blobToDataUrl(fullCompressed?.blob ?? fullBlob);
          thumbnail_data_url = await blobToDataUrl(thumbCompressed?.blob ?? fullBlob);
        }
      } else {
        // mode === 'hair'
        const f = await deps.fetchSource(msg.hairSourceUrl);
        if (!f) {
          return err(
            'source_fetch_failed',
            "Couldn't load that hairstyle image — try right-clicking it instead",
          );
        }

        if (settings.use_placeholder_images) {
          const ph = makePlaceholderResult();
          full_data_url = ph.full_data_url;
          thumbnail_data_url = ph.thumbnail_data_url;
        } else {
          const refSplit = splitDataUrl(ref.data_url);
          const deviceId = await getOrCreateDeviceId();
          const hairSplit = splitDataUrl(f.data_url);
          const live = await callGenerate(
            {
              mode: 'hair',
              device_id: deviceId,
              reference_photo_b64: refSplit.b64,
              reference_mime: refSplit.mime,
              hair_source_b64: hairSplit.b64,
              hair_source_mime: f.mime_type || hairSplit.mime,
            },
            deps.backend,
          );
          if (!live.ok) return err(live.code, live.message);
          const fullBlob = await base64ToBlob(live.image_b64, live.mime_type);
          const fullCompressed = await compressBlob(fullBlob, 1024, 0.85).catch(() => null);
          const thumbCompressed = await compressBlob(fullBlob, 256, 0.8).catch(() => null);
          full_data_url = await blobToDataUrl(fullCompressed?.blob ?? fullBlob);
          thumbnail_data_url = await blobToDataUrl(thumbCompressed?.blob ?? fullBlob);
        }
      }

      const result = {
        id: uuidv4(),
        mode: msg.mode,
        full_data_url,
        thumbnail_data_url,
        created_at: Date.now(),
      };
      await addRecentResult(result);
      return { ok: true, result, ms_taken: Date.now() - t0 };
    }

    case 'SET_OUTFIT_TYPE': {
      await writeOutfitType(msg.outfitType);
      const reconciled = reconcileGarments(await readPending(), msg.outfitType);
      await writePending(reconciled);
      return { ok: true };
    }

    case 'SOURCE_IMAGE_SELECTED': {
      // Hover "Try on" pill and right-click "Try this on with TryOn" both land
      // here. Routing:
      //
      // - Right-click (origin='context_menu'): always garment. The user picked
      //   the explicit garment menu entry, so respect it. (Right-click
      //   "Use as accessory" goes through ADD_PENDING_ACCESSORY directly.)
      //
      // - Hover button (origin='hover'): smart-route. If the user is in
      //   custom-accessory mode AND has already picked at least one garment,
      //   the next hover-click becomes an accessory instead of mutating
      //   garments. This handles the "I picked top, now I want to add a
      //   watch" flow without the user having to remember to right-click.
      const [outfitType, mode, garments] = await Promise.all([
        readOutfitType(),
        readAccessoriesMode(),
        readPending(),
      ]);
      const isHover = msg.origin === 'hover';
      if (isHover && mode === 'custom' && garments.length >= 1) {
        const list = await readPendingAccessories();
        const exists = list.some((a) => a.url === msg.url);
        if (!exists) {
          await writePendingAccessories([...list, { url: msg.url, origin: 'hover' }]);
        }
        return { ok: true };
      }
      const incoming: PendingGarment = {
        slot: outfitType === 'full' ? 'full' : msg.slot ?? 'top',
        url: msg.url,
        origin: msg.origin,
      };
      const next = applyAdd(garments, incoming, outfitType);
      await writePending(next);
      return { ok: true };
    }

    case 'ADD_PENDING_GARMENT': {
      const outfitType = await readOutfitType();
      const next = applyAdd(await readPending(), msg.garment, outfitType);
      await writePending(next);
      return { ok: true };
    }

    case 'REMOVE_PENDING_GARMENT': {
      const list = await readPending();
      const next = list.filter((_, i) => i !== msg.index);
      await writePending(next);
      return { ok: true };
    }

    case 'SET_GARMENT_SLOT': {
      // Kept for legacy compatibility but no longer surfaced in the UI; the
      // outfit-type picker handles slot semantics now.
      const list = await readPending();
      const target = list[msg.index];
      if (!target) return { ok: true };
      const next = list.slice();
      next[msg.index] = { ...target, slot: msg.slot };
      await writePending(next);
      return { ok: true };
    }

    case 'GET_PENDING_GARMENTS':
      return { ok: true, garments: await readPending() };

    case 'CLEAR_PENDING_GARMENTS':
      await writePending([]);
      return { ok: true };

    case 'SET_ACCESSORIES_MODE':
      await chrome.storage.session.set({ [ACCESSORIES_MODE_KEY]: msg.mode });
      if (msg.mode !== 'custom') {
        await writePendingAccessories([]);
      }
      return { ok: true };

    case 'ADD_PENDING_ACCESSORY': {
      const list = await readPendingAccessories();
      // Idempotent on URL.
      const exists = list.some((a) => a.url === msg.accessory.url);
      const next = exists ? list : [...list, msg.accessory];
      await writePendingAccessories(next);
      // Auto-flip mode to 'custom' so the user immediately sees the effect.
      const current = await readAccessoriesMode();
      if (current !== 'custom') {
        await chrome.storage.session.set({ [ACCESSORIES_MODE_KEY]: 'custom' });
      }
      return { ok: true };
    }

    case 'REMOVE_PENDING_ACCESSORY': {
      const list = await readPendingAccessories();
      await writePendingAccessories(list.filter((_, i) => i !== msg.index));
      return { ok: true };
    }

    case 'CLEAR_PENDING_ACCESSORIES':
      await writePendingAccessories([]);
      return { ok: true };

    case 'GET_TRYON_STATE': {
      const [outfitType, accessoriesMode, garments, accessories] = await Promise.all([
        readOutfitType(),
        readAccessoriesMode(),
        readPending(),
        readPendingAccessories(),
      ]);
      return { ok: true, outfitType, accessoriesMode, garments, accessories };
    }

    case 'SET_PENDING_HAIR_SOURCE':
      await chrome.storage.session.set({ [HAIR_SOURCE_KEY]: msg.source });
      return { ok: true };

    case 'CLEAR_PENDING_HAIR_SOURCE':
      await chrome.storage.session.remove(HAIR_SOURCE_KEY);
      return { ok: true };

    case 'GET_HAIR_STATE': {
      const out = await chrome.storage.session.get(HAIR_SOURCE_KEY);
      const v = out[HAIR_SOURCE_KEY] as PendingHairSource | undefined;
      return { ok: true, source: v ?? null };
    }

    default: {
      const _exhaustive: never = msg;
      void _exhaustive;
      return err('unknown_message', 'Unknown message type');
    }
  }
}
