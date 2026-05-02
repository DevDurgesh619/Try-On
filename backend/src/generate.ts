import {
  ACCESSORY_FROM_IMAGE_CLAUSE,
  ACCESSORY_FROM_MODEL_CLAUSE,
  HAIR_PROMPT,
  OUTFIT_BOTTOM_PROMPT,
  OUTFIT_FULL_PROMPT,
  OUTFIT_TOP_AND_BOTTOM_PROMPT,
  OUTFIT_TOP_PROMPT,
} from './prompts';
import { checkAndIncrement, type RateLimitStore } from './ratelimit';
import type { Env } from './index';

export const GEMINI_MODEL = 'gemini-3.1-flash-image-preview';

export type Mode = 'outfit' | 'hair' | 'blend';
export type GarmentSlot = 'top' | 'bottom' | 'full';
export type AccessoriesMode = 'off' | 'model' | 'custom';

export interface GarmentInput {
  slot: GarmentSlot;
  image: string;
  mime: string;
}

export interface AccessoryInput {
  image: string;
  mime: string;
}

export interface OutfitGenerateBody {
  device_id: string;
  mode: 'outfit';
  reference_photo: string;
  reference_mime: string;
  garments: GarmentInput[];
  accessoriesMode: AccessoriesMode;
  accessories?: AccessoryInput[];
}

export interface HairSourceInput {
  image: string;
  mime: string;
}

export interface HairGenerateBody {
  device_id: string;
  mode: 'hair';
  reference_photo: string;
  reference_mime: string;
  hair_source: HairSourceInput;
}

export type GenerateBody = OutfitGenerateBody | HairGenerateBody;

export type ErrorCode =
  | 'invalid_body'
  | 'rate_limited'
  | 'gemini_safety_block'
  | 'gemini_timeout'
  | 'gemini_no_image'
  | 'backend_error';

export interface ErrorPayload {
  ok: false;
  code: ErrorCode;
  message: string;
}
export interface SuccessPayload {
  ok: true;
  image: string;
  mime_type: string;
  generation_id: string;
  ms_taken: number;
}

export interface GeminiPart {
  text?: string;
  inlineData?: { mimeType: string; data: string };
}

export interface GeminiClient {
  generate(input: {
    prompt: string;
    images: { mimeType: string; data: string }[];
    signal?: AbortSignal;
  }): Promise<GeminiPart[]>;
}

export interface GenerateDeps {
  gemini: GeminiClient;
  store: RateLimitStore | null;
  now?: () => Date;
  uuid?: () => string;
  timeoutMs?: number;
}

function err(code: ErrorCode, message: string, status: number): Response {
  const body: ErrorPayload = { ok: false, code, message };
  return Response.json(body, { status });
}

function isNonEmptyString(s: unknown): s is string {
  return typeof s === 'string' && s.length > 0;
}

function isGarment(raw: unknown): raw is GarmentInput {
  if (!raw || typeof raw !== 'object') return false;
  const g = raw as Record<string, unknown>;
  if (g.slot !== 'top' && g.slot !== 'bottom' && g.slot !== 'full') return false;
  if (!isNonEmptyString(g.image)) return false;
  if (!isNonEmptyString(g.mime)) return false;
  return true;
}

/**
 * Returns the garments in canonical order (top before bottom for 2-slot),
 * or null if the combination is invalid.
 */
export function validateAndOrderGarments(garments: GarmentInput[]): GarmentInput[] | null {
  if (garments.length === 1) return garments;
  if (garments.length !== 2) return null;
  const slots = garments.map((g) => g.slot).sort().join(',');
  if (slots !== 'bottom,top') return null;
  const top = garments.find((g) => g.slot === 'top');
  const bottom = garments.find((g) => g.slot === 'bottom');
  if (!top || !bottom) return null;
  return [top, bottom];
}

export function pickPrompt(garments: GarmentInput[]): string | null {
  if (garments.length === 1) {
    const g = garments[0];
    if (!g) return null;
    if (g.slot === 'full') return OUTFIT_FULL_PROMPT;
    if (g.slot === 'top') return OUTFIT_TOP_PROMPT;
    if (g.slot === 'bottom') return OUTFIT_BOTTOM_PROMPT;
    return null;
  }
  if (garments.length === 2) return OUTFIT_TOP_AND_BOTTOM_PROMPT;
  return null;
}

/**
 * Compose the final prompt: base outfit prompt + accessory clause (if any).
 * The clause is inserted before the trailing "single image" line so the model
 * still sees that instruction last.
 */
export function buildPrompt(base: string, accessoriesMode: AccessoriesMode): string {
  if (accessoriesMode === 'off') return base;
  const clause =
    accessoriesMode === 'model' ? ACCESSORY_FROM_MODEL_CLAUSE : ACCESSORY_FROM_IMAGE_CLAUSE;
  const tail = '- The output must be a single image. Do not return text.';
  if (base.endsWith(tail)) {
    const head = base.slice(0, -tail.length).trimEnd();
    return `${head}\n\n${clause}\n\n${tail}`;
  }
  return `${base}\n\n${clause}`;
}

function isAccessory(raw: unknown): raw is AccessoryInput {
  if (!raw || typeof raw !== 'object') return false;
  const a = raw as Record<string, unknown>;
  return isNonEmptyString(a.image) && isNonEmptyString(a.mime);
}

function isHairSource(raw: unknown): raw is HairSourceInput {
  if (!raw || typeof raw !== 'object') return false;
  const h = raw as Record<string, unknown>;
  return isNonEmptyString(h.image) && isNonEmptyString(h.mime);
}

function parseBody(raw: unknown): GenerateBody | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!isNonEmptyString(r.device_id)) return null;
  if (!isNonEmptyString(r.reference_photo)) return null;
  const reference_mime = typeof r.reference_mime === 'string' ? r.reference_mime : 'image/jpeg';

  if (r.mode === 'outfit') {
    if (!Array.isArray(r.garments)) return null;
    if (!r.garments.every(isGarment)) return null;
    const accessoriesMode: AccessoriesMode =
      r.accessoriesMode === 'model' || r.accessoriesMode === 'custom' ? r.accessoriesMode : 'off';
    const accessories = Array.isArray(r.accessories) && r.accessories.every(isAccessory)
      ? r.accessories
      : undefined;
    if (accessoriesMode === 'custom' && (!accessories || accessories.length === 0)) return null;
    return {
      device_id: r.device_id,
      mode: 'outfit',
      reference_photo: r.reference_photo,
      reference_mime,
      garments: r.garments,
      accessoriesMode,
      ...(accessories && accessories.length > 0 ? { accessories } : {}),
    };
  }

  if (r.mode === 'hair') {
    if (!isHairSource(r.hair_source)) return null;
    return {
      device_id: r.device_id,
      mode: 'hair',
      reference_photo: r.reference_photo,
      reference_mime,
      hair_source: r.hair_source,
    };
  }

  // 'blend' and any unknown mode: rejected.
  return null;
}

function findFirstImagePart(parts: GeminiPart[]): { mimeType: string; data: string } | null {
  for (const p of parts) {
    if (p.inlineData?.data && p.inlineData.mimeType.startsWith('image/')) return p.inlineData;
  }
  return null;
}

export async function handleGenerate(
  request: Request,
  env: Env,
  deps: GenerateDeps,
): Promise<Response> {
  const t0 = Date.now();

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return err('invalid_body', 'Body must be JSON', 400);
  }

  const body = parseBody(raw);
  if (!body) return err('invalid_body', 'Missing or invalid fields', 400);

  if (deps.store) {
    const rl = await checkAndIncrement(deps.store, body.device_id);
    if (!rl.allowed) {
      const res = err(
        'rate_limited',
        "You've used your daily try-ons. Resets at midnight UTC.",
        429,
      );
      res.headers.set('X-RateLimit-Remaining', '0');
      res.headers.set('X-RateLimit-Reset', String(Math.floor(rl.resetEpochMs / 1000)));
      return res;
    }
  }

  // Per-mode dispatch: build the prompt and the ordered image array.
  let prompt: string;
  let images: { mimeType: string; data: string }[];

  if (body.mode === 'outfit') {
    const ordered = validateAndOrderGarments(body.garments);
    if (!ordered) {
      return err(
        'invalid_body',
        'garments must be exactly one entry, or one "top" and one "bottom"',
        400,
      );
    }
    const basePrompt = pickPrompt(ordered);
    if (!basePrompt) return err('invalid_body', 'no prompt for this garment combination', 400);
    prompt = buildPrompt(basePrompt, body.accessoriesMode);
    images = [
      { mimeType: body.reference_mime, data: body.reference_photo },
      ...ordered.map((g) => ({ mimeType: g.mime, data: g.image })),
      ...(body.accessoriesMode === 'custom' && body.accessories
        ? body.accessories.map((a) => ({ mimeType: a.mime, data: a.image }))
        : []),
    ];
  } else {
    // 'hair' — only mode 2 v1 ships hair-only.
    prompt = HAIR_PROMPT;
    images = [
      { mimeType: body.reference_mime, data: body.reference_photo },
      { mimeType: body.hair_source.mime, data: body.hair_source.image },
    ];
  }

  const ctrl = new AbortController();
  const timeoutMs = deps.timeoutMs ?? 120_000;
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const parts = await deps.gemini.generate({
      prompt,
      images,
      signal: ctrl.signal,
    });
    clearTimeout(timer);

    const image = findFirstImagePart(parts);
    if (!image) {
      const text = parts.find((p) => p.text)?.text ?? '';
      const isSafety = /safety|blocked|policy/i.test(text);
      return err(
        isSafety ? 'gemini_safety_block' : 'gemini_no_image',
        isSafety ? "Couldn't generate that one — try a different photo or item" : 'No image in response',
        isSafety ? 422 : 502,
      );
    }

    const ok: SuccessPayload = {
      ok: true,
      image: image.data,
      mime_type: image.mimeType,
      generation_id: (deps.uuid ?? crypto.randomUUID.bind(crypto))(),
      ms_taken: Date.now() - t0,
    };
    void env;
    return Response.json(ok);
  } catch (e) {
    clearTimeout(timer);
    if (e instanceof Error && e.name === 'AbortError') {
      return err('gemini_timeout', 'Generation took too long', 504);
    }
    const message = e instanceof Error ? e.message : 'unknown';
    return err('backend_error', message, 502);
  }
}

// ---------- Default Gemini client (REST) ----------

export class RestGeminiClient implements GeminiClient {
  constructor(private readonly apiKey: string) {}

  async generate(input: {
    prompt: string;
    images: { mimeType: string; data: string }[];
    signal?: AbortSignal;
  }): Promise<GeminiPart[]> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
    const body = {
      contents: [
        {
          parts: [
            ...input.images.map((img) => ({ inlineData: { mimeType: img.mimeType, data: img.data } })),
            { text: input.prompt },
          ],
        },
      ],
      generationConfig: { responseModalities: ['IMAGE'] },
    };
    const init: RequestInit = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': this.apiKey,
      },
      body: JSON.stringify(body),
    };
    if (input.signal) init.signal = input.signal;
    const res = await fetch(url, init);
    if (!res.ok) {
      throw new Error(`gemini_http_${res.status}`);
    }
    const json = (await res.json()) as { candidates?: { content?: { parts?: GeminiPart[] } }[] };
    const parts = json.candidates?.[0]?.content?.parts ?? [];
    return parts;
  }
}
