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

export interface OutfitGenerateInput {
  mode: 'outfit';
  device_id: string;
  reference_photo_b64: string;
  reference_mime: string;
  garments: BackendGarment[];
  accessoriesMode: AccessoriesMode;
  accessories?: BackendAccessory[];
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
}

const REMOTE_TO_LOCAL: Record<string, BackendErrorCode> = {
  rate_limited: 'rate_limited',
  gemini_safety_block: 'gemini_safety_block',
  gemini_timeout: 'gemini_timeout',
  invalid_body: 'backend_error',
  gemini_no_image: 'backend_error',
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
        },
  );

  let lastErr: GenerateErr = {
    ok: false,
    code: 'backend_error',
    message: 'no attempts made',
  };

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetcher(`${baseUrl}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
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
