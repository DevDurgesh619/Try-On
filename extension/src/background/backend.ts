import { getWorkerConfig } from '@/lib/config';
import type { AccessoriesMode, ErrorResponse, GarmentSlot } from '@/lib/types';

export type BackendErrorCode = ErrorResponse['code'];

export interface BackendGarment {
  slot: GarmentSlot;
  image_b64: string;
  mime: string;
}

export interface BackendAccessory {
  image_b64: string;
  mime: string;
}

export interface BackendHairSource {
  image_b64: string;
  mime: string;
}

export interface OutfitGenerateInput {
  mode: 'outfit';
  device_id: string;
  reference_photo_b64: string;
  reference_mime: string;
  garments: BackendGarment[];
  accessoriesMode: AccessoriesMode;
  accessories?: BackendAccessory[];
  /** Optional convenience hairstyle reference attached to an outfit try-on. */
  hair_source?: BackendHairSource;
}

export interface HairGenerateInput {
  mode: 'hair';
  device_id: string;
  reference_photo_b64: string;
  reference_mime: string;
  hair_source_b64: string;
  hair_source_mime: string;
}

export type GenerateInput = OutfitGenerateInput | HairGenerateInput;

export interface GenerateOk {
  ok: true;
  image_b64: string;
  mime_type: string;
  generation_id: string;
  ms_taken: number;
}

export interface GenerateErr {
  ok: false;
  code: BackendErrorCode;
  message: string;
}

interface FetchLike {
  (input: string, init?: RequestInit): Promise<Response>;
}

export interface BackendDeps {
  fetch?: FetchLike;
  baseUrl?: string;
  retries?: number;
  retryDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  /** Returns the current Bearer JWT, refreshing if needed. null if signed out. */
  getAccessToken?: () => Promise<string | null>;
  /** Forces a refresh after a 401. Returns the new JWT or null. */
  forceRefresh?: () => Promise<string | null>;
}

const REMOTE_TO_LOCAL: Record<string, BackendErrorCode> = {
  rate_limited: 'rate_limited',
  out_of_credits: 'out_of_credits',
  daily_cap: 'daily_cap',
  auth_required: 'auth_required',
  auth_expired: 'auth_expired',
  gemini_safety_block: 'gemini_safety_block',
  gemini_timeout: 'gemini_timeout',
  invalid_body: 'backend_error',
  gemini_no_image: 'gemini_no_image',
  backend_error: 'backend_error',
};

function mapRemoteCode(code: string | undefined): BackendErrorCode {
  if (code) {
    const mapped = REMOTE_TO_LOCAL[code];
    if (mapped) return mapped;
  }
  return 'backend_error';
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export async function callGenerate(
  input: GenerateInput,
  deps: BackendDeps = {},
): Promise<GenerateOk | GenerateErr> {
  const baseUrl = deps.baseUrl ?? getWorkerConfig().baseUrl;
  const fetcher = deps.fetch ?? fetch.bind(globalThis);
  const retries = deps.retries ?? 1;
  const retryDelayMs = deps.retryDelayMs ?? 800;
  const sleep = deps.sleep ?? defaultSleep;

  const body = JSON.stringify(
    input.mode === 'hair'
      ? {
          device_id: input.device_id,
          mode: 'hair',
          reference_photo: input.reference_photo_b64,
          reference_mime: input.reference_mime,
          hair_source: { image: input.hair_source_b64, mime: input.hair_source_mime },
        }
      : {
          device_id: input.device_id,
          mode: 'outfit',
          reference_photo: input.reference_photo_b64,
          reference_mime: input.reference_mime,
          garments: input.garments.map((g) => ({
            slot: g.slot,
            image: g.image_b64,
            mime: g.mime,
          })),
          accessoriesMode: input.accessoriesMode,
          ...(input.accessories && input.accessories.length > 0
            ? {
                accessories: input.accessories.map((a) => ({
                  image: a.image_b64,
                  mime: a.mime,
                })),
              }
            : {}),
          ...(input.hair_source
            ? { hair_source: { image: input.hair_source.image_b64, mime: input.hair_source.mime } }
            : {}),
        },
  );

  let lastErr: GenerateErr = {
    ok: false,
    code: 'backend_error',
    message: 'no attempts made',
  };

  // Resolve the current access token (if any). Failures are non-fatal — we
  // proceed anonymously. The Worker handles the auth-required vs anonymous
  // routing based on whether Authorization is present.
  const getToken = deps.getAccessToken ?? ((): Promise<string | null> => Promise.resolve(null));
  const forceRefresh = deps.forceRefresh ?? ((): Promise<string | null> => Promise.resolve(null));

  let bearer: string | null = null;
  try {
    bearer = await getToken();
  } catch {
    bearer = null;
  }

  // Build version is sent on every request so Cloudflare logs can correlate
  // post-launch behavior (paywall hits, error rates, latency) to a specific
  // extension build. Cheap, single header.
  const buildVersion = (() => {
    try {
      return chrome.runtime.getManifest().version;
    } catch {
      return 'unknown';
    }
  })();

  /** Build headers for the fetch attempt. */
  function makeHeaders(token: string | null): Record<string, string> {
    const h: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-TryOn-Build': buildVersion,
    };
    if (token) h.Authorization = `Bearer ${token}`;
    return h;
  }

  let didRefresh = false;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetcher(`${baseUrl}/generate`, {
        method: 'POST',
        headers: makeHeaders(bearer),
        body,
      });

      // 401 with auth_expired → refresh once, retry. After one refresh attempt
      // (per call), give up so we don't loop.
      if (res.status === 401 && bearer && !didRefresh) {
        didRefresh = true;
        const fresh = await forceRefresh();
        if (fresh) {
          bearer = fresh;
          continue;
        }
        // Refresh failed — surface as auth_required so the UI can prompt sign-in.
        return { ok: false, code: 'auth_required', message: 'session expired, please sign in again' };
      }

      if (res.status >= 500 && attempt < retries) {
        lastErr = { ok: false, code: 'backend_error', message: `worker_${res.status}` };
        await sleep(retryDelayMs);
        continue;
      }
      const json = (await res.json().catch(() => null)) as
        | { ok: true; image: string; mime_type: string; generation_id: string; ms_taken: number }
        | { ok: false; code: string; message: string }
        | null;
      if (!json) {
        return { ok: false, code: 'backend_error', message: `bad_json_status_${res.status}` };
      }
      if (json.ok) {
        return {
          ok: true,
          image_b64: json.image,
          mime_type: json.mime_type,
          generation_id: json.generation_id,
          ms_taken: json.ms_taken,
        };
      }
      return { ok: false, code: mapRemoteCode(json.code), message: json.message };
    } catch (e) {
      lastErr = {
        ok: false,
        code: 'backend_error',
        message: e instanceof Error ? e.message : 'fetch_failed',
      };
      if (attempt < retries) await sleep(retryDelayMs);
    }
  }

  return lastErr;
}
