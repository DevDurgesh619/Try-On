import {
  ACCESSORY_FROM_IMAGE_CLAUSE,
  ACCESSORY_FROM_MODEL_CLAUSE,
  HAIR_IN_OUTFIT_CLAUSE,
  HAIR_PROMPT,
  OUTFIT_BOTTOM_PROMPT,
  OUTFIT_FULL_PROMPT,
  OUTFIT_TOP_AND_BOTTOM_PROMPT,
  OUTFIT_TOP_PROMPT,
} from './prompts';
import {
  decrementForGeneration,
  nextUtcMidnightMs,
  type Identity,
} from './credits';
import type { Db } from './db';
import {
  extractBearer,
  verifyAccessToken,
} from './auth';
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

export interface HairSourceInput {
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
  /** Optional hairstyle reference for the convenience hair toggle inside the
   * outfit pipeline. The Hair tab (Mode 2) remains the higher-quality path. */
  hair_source?: HairSourceInput;
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
  | 'out_of_credits'
  | 'daily_cap'
  | 'auth_required'
  | 'auth_expired'
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
  /** Credits store. Null skips the credits check entirely (test-only). */
  db: Db | null;
  /** Worker-secret value for verifying Bearer JWTs. Empty string disables auth. */
  jwtSecret?: string;
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
 * Compose the final prompt: base outfit prompt + accessory clause (if any) +
 * hair-in-outfit clause (if any). Clauses go in order — accessory first, then
 * hair — matching the image-array ordering (accessories before the hair
 * source), and all are inserted before the trailing "single image" line so
 * the model still sees that instruction last.
 */
export function buildPrompt(
  base: string,
  accessoriesMode: AccessoriesMode,
  hasHairSource = false,
): string {
  const tail = '- The output must be a single image. Do not return text.';
  const clauses: string[] = [];
  if (accessoriesMode === 'model') clauses.push(ACCESSORY_FROM_MODEL_CLAUSE);
  if (accessoriesMode === 'custom') clauses.push(ACCESSORY_FROM_IMAGE_CLAUSE);
  if (hasHairSource) clauses.push(HAIR_IN_OUTFIT_CLAUSE);
  if (clauses.length === 0) return base;
  if (base.endsWith(tail)) {
    const head = base.slice(0, -tail.length).trimEnd();
    return `${head}\n\n${clauses.join('\n\n')}\n\n${tail}`;
  }
  return `${base}\n\n${clauses.join('\n\n')}`;
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
    const hair_source = isHairSource(r.hair_source) ? r.hair_source : undefined;
    return {
      device_id: r.device_id,
      mode: 'outfit',
      reference_photo: r.reference_photo,
      reference_mime,
      garments: r.garments,
      accessoriesMode,
      ...(accessories && accessories.length > 0 ? { accessories } : {}),
      ...(hair_source ? { hair_source } : {}),
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

  // Identity: Bearer JWT wins over device_id. If a JWT is present but invalid,
  // we surface auth_required/auth_expired so the client can refresh — we do
  // NOT silently fall back to anonymous, because that would let an attacker
  // strip auth headers to bypass per-user rate limits.
  let identity: Identity = { kind: 'device', deviceId: body.device_id };
  const bearer = extractBearer(request.headers);
  if (bearer) {
    if (!deps.jwtSecret) {
      return err('backend_error', 'auth not configured', 500);
    }
    const result = await verifyAccessToken(bearer, deps.jwtSecret);
    if (!result.ok) {
      return err(
        result.reason === 'expired' ? 'auth_expired' : 'auth_required',
        result.reason === 'expired' ? 'Access token expired' : 'Invalid auth token',
        401,
      );
    }
    identity = { kind: 'user', userId: result.claims.sub };
  }

  if (deps.db) {
    const nowMs = (deps.now ?? ((): Date => new Date()))().getTime();
    const ledgerId = (deps.uuid ?? crypto.randomUUID.bind(crypto))();
    const dec = await decrementForGeneration(deps.db, identity, {
      now: nowMs,
      dailyResetsAt: nextUtcMidnightMs(new Date(nowMs)),
      ledgerId,
    });
    if (!dec.ok) {
      const code: ErrorCode = dec.reason === 'daily_cap' ? 'daily_cap' : 'out_of_credits';
      const message = dec.reason === 'daily_cap'
        ? "You've hit today's safety cap. Try again after UTC midnight."
        : identity.kind === 'user'
          ? "You've used all your free try-ons. Paid plans are coming soon."
          : "You've used your 5 free try-ons on this device. Sign in with Google for 5 more free.";
      // Telemetry: emit a single line so we can grep Cloudflare logs to count
      // out_of_credits and daily_cap hits per build/user.
      const build = request.headers.get('x-tryon-build') ?? '?';
      const idStr = identity.kind === 'user'
        ? `user=${identity.userId}`
        : `device=${identity.deviceId}`;
      console.info(`[tryon] paywall code=${code} ${idStr} build=${build}`);
      return err(code, message, 402);
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
    prompt = buildPrompt(basePrompt, body.accessoriesMode, !!body.hair_source);
    images = [
      { mimeType: body.reference_mime, data: body.reference_photo },
      ...ordered.map((g) => ({ mimeType: g.mime, data: g.image })),
      ...(body.accessoriesMode === 'custom' && body.accessories
        ? body.accessories.map((a) => ({ mimeType: a.mime, data: a.image }))
        : []),
      ...(body.hair_source
        ? [{ mimeType: body.hair_source.mime, data: body.hair_source.image }]
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
