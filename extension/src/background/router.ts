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
import {
  forceRefresh as authForceRefresh,
  getCachedEmail,
  getValidAccessToken,
  isSignedIn,
  signIn as authSignIn,
  signOut as authSignOut,
} from '@/lib/auth';
import { getWorkerConfig } from '@/lib/config';
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
  PendingTarget,
} from '@/lib/types';

const PENDING_KEY = 'pending_garments';
const ACCESSORIES_KEY = 'pending_accessories';
const ACCESSORIES_MODE_KEY = 'accessories_mode';
const OUTFIT_TYPE_KEY = 'outfit_type';
const HAIR_SOURCE_KEY = 'pending_hair_source';
const OUTFIT_HAIR_SOURCE_KEY = 'pending_outfit_hair_source';
const ACTIVE_TAB_KEY = 'active_tab';
const PENDING_TARGET_KEY = 'pending_target';

const VALID_TARGETS: ReadonlySet<PendingTarget> = new Set([
  'full',
  'top',
  'bottom',
  'accessory',
  'hair',
]);

async function readPendingTarget(): Promise<PendingTarget> {
  const out = await chrome.storage.session.get(PENDING_TARGET_KEY);
  const v = out[PENDING_TARGET_KEY];
  return typeof v === 'string' && VALID_TARGETS.has(v as PendingTarget)
    ? (v as PendingTarget)
    : 'full';
}

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

async function writeOutfitType(t: OutfitType): Promise<void> {
  // Kept only for the legacy SET_OUTFIT_TYPE message — the new UI drives
  // slot semantics through SET_PENDING_TARGET.
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

/**
 * Garment add driven by the user-selected pending target. This is the
 * primary path for the new "pick what slot the next click fills" UX:
 *
 *   - target='full' → replaces the whole list with one full garment.
 *     (Top/bottom are mutually exclusive with full.)
 *   - target='top' or 'bottom' → drops any 'full' garment, replaces the
 *     same slot if filled, keeps the opposite slot intact.
 *
 * Idempotent on URL.
 */
export function applyAddByTarget(
  existing: PendingGarment[],
  incoming: PendingGarment,
  target: 'full' | 'top' | 'bottom',
): PendingGarment[] {
  if (target === 'full') {
    return [{ ...incoming, slot: 'full' }];
  }
  // Drop any 'full' (mutex) and the same target slot (replacement). Keep the
  // opposite slot. Then append the new garment with the explicit slot.
  const kept = existing.filter((g) => g.slot !== 'full' && g.slot !== target);
  return [...kept, { ...incoming, slot: target }];
}

/**
 * Inject the auth callbacks the BackendDeps interface expects. Tests can
 * override BackendDeps explicitly; production calls go through here.
 */
function withAuthDeps(existing?: BackendDeps): BackendDeps {
  if (existing && (existing.getAccessToken || existing.forceRefresh)) return existing;
  return {
    ...existing,
    getAccessToken: () => getValidAccessToken(),
    forceRefresh: () => authForceRefresh(),
  };
}

// ---------- account / auth helpers ----------

interface FetchAccountStateResult {
  signedIn: boolean;
  email?: string | undefined;
  free_credits_remaining?: number | undefined;
  paid_credits_balance?: number | undefined;
  credits_remaining?: number | undefined;
  daily_used?: number | undefined;
  daily_limit?: number | undefined;
}

/**
 * Resolves the user's account snapshot:
 *   - If not signed in (no stored tokens), returns { signedIn: false }.
 *   - If signed in, calls /me and returns the live record.
 *   - If /me fails (network/refresh problem), returns the cached email-only
 *     view so the UI doesn't flap, and lets the next call retry.
 *
 * `refresh` flag is informational — we always call /me when signed in; the
 * flag is for future use if we want to add a short cache window.
 */
async function fetchAccountState(_refresh = false): Promise<FetchAccountStateResult> {
  void _refresh;
  if (!(await isSignedIn())) return { signedIn: false };
  const token = await getValidAccessToken();
  if (!token) {
    // Tokens were stored but refresh failed — clear stale state.
    await authSignOut();
    return { signedIn: false };
  }
  const baseUrl = getWorkerConfig().baseUrl;
  try {
    const res = await fetch(`${baseUrl}/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      // 401 → tokens dead. Clear and return signed-out view.
      if (res.status === 401) {
        await authSignOut();
        return { signedIn: false };
      }
      // Transient — return last-known email so the chip stays.
      const email = await getCachedEmail();
      return { signedIn: true, ...(email ? { email } : {}) };
    }
    const json = (await res.json()) as {
      ok: boolean;
      user?: {
        email?: string;
        free_credits_remaining?: number;
        paid_credits_balance?: number;
        credits_remaining?: number;
        daily_used?: number;
        daily_limit?: number;
      };
    };
    if (!json.ok || !json.user) {
      const email = await getCachedEmail();
      return { signedIn: true, ...(email ? { email } : {}) };
    }
    return {
      signedIn: true,
      ...(json.user.email ? { email: json.user.email } : {}),
      ...(typeof json.user.free_credits_remaining === 'number'
        ? { free_credits_remaining: json.user.free_credits_remaining }
        : {}),
      ...(typeof json.user.paid_credits_balance === 'number'
        ? { paid_credits_balance: json.user.paid_credits_balance }
        : {}),
      ...(typeof json.user.credits_remaining === 'number'
        ? { credits_remaining: json.user.credits_remaining }
        : {}),
      ...(typeof json.user.daily_used === 'number' ? { daily_used: json.user.daily_used } : {}),
      ...(typeof json.user.daily_limit === 'number' ? { daily_limit: json.user.daily_limit } : {}),
    };
  } catch {
    const email = await getCachedEmail();
    return { signedIn: true, ...(email ? { email } : {}) };
  }
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

          let hairSource: { image_b64: string; mime: string } | undefined;
          if (msg.outfitHairSourceUrl) {
            const hf = await deps.fetchSource(msg.outfitHairSourceUrl);
            if (!hf) {
              return err('source_fetch_failed', "Couldn't load the hairstyle image.");
            }
            const s = splitDataUrl(hf.data_url);
            hairSource = { image_b64: s.b64, mime: hf.mime_type || s.mime };
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
              ...(hairSource ? { hair_source: hairSource } : {}),
            },
            withAuthDeps(deps.backend),
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
            withAuthDeps(deps.backend),
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
      // Legacy message kept so any older callers still work. The new UI
      // drives slot semantics through SET_PENDING_TARGET. We map the legacy
      // outfit-type onto a sensible default target.
      await writeOutfitType(msg.outfitType);
      const reconciled = reconcileGarments(await readPending(), msg.outfitType);
      await writePending(reconciled);
      await chrome.storage.session.set({
        [PENDING_TARGET_KEY]: msg.outfitType === 'full' ? 'full' : 'top',
      });
      return { ok: true };
    }

    case 'SET_PENDING_TARGET': {
      // Switching the active target may need to reconcile the existing
      // garments to keep the {1 full} XOR {1 top + 1 bottom} invariant:
      //
      //  - target='full'  → drop any existing top/bottom (mutex with full).
      //  - target='top'   → drop any existing 'full'.
      //  - target='bottom'→ drop any existing 'full'.
      //  - target='accessory' → no garment changes; auto-set
      //    accessoriesMode='custom' so the next click adds to the list and
      //    the slot is meaningful at generation time.
      //  - target='hair'  → no side effects.
      //
      // The actual image is added on the NEXT click (hover button or
      // right-click), not here.
      await chrome.storage.session.set({ [PENDING_TARGET_KEY]: msg.target });
      if (msg.target === 'full') {
        const cur = await readPending();
        const fullOnly = cur.find((g) => g.slot === 'full');
        await writePending(fullOnly ? [fullOnly] : []);
      } else if (msg.target === 'top' || msg.target === 'bottom') {
        const cur = await readPending();
        await writePending(cur.filter((g) => g.slot !== 'full'));
      } else if (msg.target === 'accessory') {
        const cur = await readAccessoriesMode();
        if (cur !== 'custom') {
          await chrome.storage.session.set({ [ACCESSORIES_MODE_KEY]: 'custom' });
        }
      }
      return { ok: true };
    }

    case 'SOURCE_IMAGE_SELECTED': {
      // Hover "Try on" pill and right-click "Try this on with TryOn" both
      // arrive here. Routing rules:
      //
      // - Hover (origin='hover'):
      //   1. If the side panel is on the Hair tab, route to the dedicated
      //      Hair pipeline (single-click hairstyle pick).
      //   2. Otherwise dispatch by the user-selected pendingTarget. There's
      //      no guessing — empty slots mean "use the reference original",
      //      and the user explicitly toggles which slot the next click
      //      fills.
      //
      // - Right-click (origin='context_menu'): the user picked the explicit
      //   "Try this on with TryOn" entry, so this is always a garment. We
      //   use pendingTarget for slot when it's a garment-slot value
      //   (full/top/bottom) and fall back to 'full' otherwise. (Right-click
      //   "Use as accessory" and "Use this hairstyle" go through their own
      //   handlers directly.)
      const isHover = msg.origin === 'hover';

      if (isHover) {
        const stored = await chrome.storage.session.get(ACTIVE_TAB_KEY);
        if (stored[ACTIVE_TAB_KEY] === 'hair') {
          await chrome.storage.session.set({
            [HAIR_SOURCE_KEY]: { url: msg.url, origin: 'hover' as const },
          });
          return { ok: true };
        }

        const target = await readPendingTarget();
        if (target === 'hair') {
          await chrome.storage.session.set({
            [OUTFIT_HAIR_SOURCE_KEY]: { url: msg.url, origin: 'hover' as const },
          });
          return { ok: true };
        }
        if (target === 'accessory') {
          const list = await readPendingAccessories();
          if (!list.some((a) => a.url === msg.url)) {
            await writePendingAccessories([...list, { url: msg.url, origin: 'hover' }]);
          }
          const cur = await readAccessoriesMode();
          if (cur !== 'custom') {
            await chrome.storage.session.set({ [ACCESSORIES_MODE_KEY]: 'custom' });
          }
          return { ok: true };
        }
        // target ∈ {'full', 'top', 'bottom'}
        const garments = await readPending();
        const incoming: PendingGarment = {
          slot: target,
          url: msg.url,
          origin: 'hover',
        };
        await writePending(applyAddByTarget(garments, incoming, target));
        return { ok: true };
      }

      // Right-click "Try this on with TryOn" — always a garment.
      const target = await readPendingTarget();
      const garmentSlot: 'full' | 'top' | 'bottom' =
        target === 'top' || target === 'bottom' || target === 'full' ? target : 'full';
      const garments = await readPending();
      const incoming: PendingGarment = {
        slot: garmentSlot,
        url: msg.url,
        origin: msg.origin,
      };
      await writePending(applyAddByTarget(garments, incoming, garmentSlot));
      return { ok: true };
    }

    case 'ADD_PENDING_GARMENT': {
      // Programmatic add — respects the slot the caller specified.
      const slot = msg.garment.slot;
      const t: 'full' | 'top' | 'bottom' = slot === 'full' || slot === 'top' || slot === 'bottom' ? slot : 'full';
      const next = applyAddByTarget(await readPending(), msg.garment, t);
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
      const [pendingTarget, accessoriesMode, garments, accessories, outfitHair] = await Promise.all([
        readPendingTarget(),
        readAccessoriesMode(),
        readPending(),
        readPendingAccessories(),
        chrome.storage.session.get(OUTFIT_HAIR_SOURCE_KEY),
      ]);
      const outfitHairSource =
        (outfitHair[OUTFIT_HAIR_SOURCE_KEY] as PendingHairSource | undefined) ?? null;
      return {
        ok: true,
        pendingTarget,
        accessoriesMode,
        garments,
        accessories,
        outfitHairSource,
      };
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

    case 'SET_PENDING_OUTFIT_HAIR_SOURCE':
      await chrome.storage.session.set({ [OUTFIT_HAIR_SOURCE_KEY]: msg.source });
      return { ok: true };

    case 'CLEAR_PENDING_OUTFIT_HAIR_SOURCE':
      await chrome.storage.session.remove(OUTFIT_HAIR_SOURCE_KEY);
      return { ok: true };

    case 'GET_OUTFIT_HAIR_STATE': {
      const out = await chrome.storage.session.get(OUTFIT_HAIR_SOURCE_KEY);
      const v = out[OUTFIT_HAIR_SOURCE_KEY] as PendingHairSource | undefined;
      return { ok: true, source: v ?? null };
    }

    case 'SET_ACTIVE_TAB':
      await chrome.storage.session.set({ [ACTIVE_TAB_KEY]: msg.tab });
      return { ok: true };

    case 'SIGN_IN': {
      try {
        await authSignIn();
      } catch (e) {
        return err('auth_failed', e instanceof Error ? e.message : 'sign_in_failed');
      }
      const account = await fetchAccountState();
      return { ok: true, account };
    }

    case 'SIGN_OUT':
      await authSignOut();
      return { ok: true };

    case 'GET_ACCOUNT_STATE': {
      const account = await fetchAccountState(msg.refresh);
      return { ok: true, account };
    }

    case 'JOIN_WAITLIST': {
      const trimmed = msg.email.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed) || trimmed.length > 254) {
        return err('invalid_email', 'Please enter a valid email');
      }
      const baseUrl = getWorkerConfig().baseUrl;
      const deviceId = await getOrCreateDeviceId();
      try {
        const res = await fetch(`${baseUrl}/waitlist`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: trimmed, device_id: deviceId }),
        });
        if (!res.ok) {
          return err('backend_error', `waitlist_${res.status}`);
        }
      } catch (e) {
        return err('backend_error', e instanceof Error ? e.message : 'waitlist_failed');
      }
      return { ok: true };
    }

    default: {
      const _exhaustive: never = msg;
      void _exhaustive;
      return err('unknown_message', 'Unknown message type');
    }
  }
}
