import { describe, it, expect, vi } from 'vitest';
import { handle } from './index';
import {
  buildPrompt,
  pickPrompt,
  validateAndOrderGarments,
  type GarmentInput,
  type GeminiClient,
  type GeminiPart,
  type GenerateDeps,
} from './generate';
import {
  ACCESSORY_FROM_IMAGE_CLAUSE,
  ACCESSORY_FROM_MODEL_CLAUSE,
  HAIR_PROMPT,
  OUTFIT_BOTTOM_PROMPT,
  OUTFIT_FULL_PROMPT,
  OUTFIT_TOP_AND_BOTTOM_PROMPT,
  OUTFIT_TOP_PROMPT,
} from './prompts';
import { type RateLimitStore } from './ratelimit';

const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

class MemStore implements RateLimitStore {
  private c = new Map<string, number>();
  async incr(key: string): Promise<number> {
    const n = (this.c.get(key) ?? 0) + 1;
    this.c.set(key, n);
    return n;
  }
}

function makeGemini(parts: GeminiPart[]): GeminiClient {
  return { generate: vi.fn(async () => parts) };
}

function garment(slot: GarmentInput['slot'], image = 'IMG'): GarmentInput {
  return { slot, image, mime: 'image/jpeg' };
}

function validBody(deviceId = 'dev-1', garments: GarmentInput[] = [garment('full', 'BB')]): unknown {
  return {
    device_id: deviceId,
    mode: 'outfit',
    reference_photo: 'AA',
    reference_mime: 'image/jpeg',
    garments,
    accessoriesMode: 'off',
  };
}

function post(body: unknown): Request {
  return new Request('https://x.test/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('pickPrompt', () => {
  it('returns OUTFIT_FULL_PROMPT for 1 full', () => {
    expect(pickPrompt([garment('full')])).toBe(OUTFIT_FULL_PROMPT);
  });
  it('returns OUTFIT_TOP_PROMPT for 1 top', () => {
    expect(pickPrompt([garment('top')])).toBe(OUTFIT_TOP_PROMPT);
  });
  it('returns OUTFIT_BOTTOM_PROMPT for 1 bottom', () => {
    expect(pickPrompt([garment('bottom')])).toBe(OUTFIT_BOTTOM_PROMPT);
  });
  it('returns OUTFIT_TOP_AND_BOTTOM_PROMPT for 2 garments', () => {
    expect(pickPrompt([garment('top'), garment('bottom')])).toBe(OUTFIT_TOP_AND_BOTTOM_PROMPT);
  });
});

describe('buildPrompt (accessories)', () => {
  it("'off' returns the base prompt unchanged", () => {
    expect(buildPrompt(OUTFIT_FULL_PROMPT, 'off')).toBe(OUTFIT_FULL_PROMPT);
  });
  it("'model' inserts the model-accessory clause before the trailing single-image line", () => {
    const out = buildPrompt(OUTFIT_TOP_PROMPT, 'model');
    expect(out).toContain(ACCESSORY_FROM_MODEL_CLAUSE);
    expect(out.endsWith('- The output must be a single image. Do not return text.')).toBe(true);
  });
  it("'custom' inserts the image-accessory clause", () => {
    const out = buildPrompt(OUTFIT_BOTTOM_PROMPT, 'custom');
    expect(out).toContain(ACCESSORY_FROM_IMAGE_CLAUSE);
    expect(out.endsWith('- The output must be a single image. Do not return text.')).toBe(true);
  });
});

describe('validateAndOrderGarments', () => {
  it('passes a single garment of any slot through', () => {
    expect(validateAndOrderGarments([garment('full')])).toHaveLength(1);
    expect(validateAndOrderGarments([garment('top')])).toHaveLength(1);
    expect(validateAndOrderGarments([garment('bottom')])).toHaveLength(1);
  });
  it('orders 2 garments top-then-bottom regardless of input order', () => {
    const out = validateAndOrderGarments([garment('bottom', 'BOT'), garment('top', 'TOP')]);
    expect(out?.map((g) => g.slot)).toEqual(['top', 'bottom']);
    expect(out?.[0]?.image).toBe('TOP');
  });
  it('rejects 0 garments', () => {
    expect(validateAndOrderGarments([])).toBeNull();
  });
  it('rejects 3 garments', () => {
    expect(
      validateAndOrderGarments([garment('top'), garment('bottom'), garment('full')]),
    ).toBeNull();
  });
  it('rejects two tops', () => {
    expect(validateAndOrderGarments([garment('top'), garment('top')])).toBeNull();
  });
  it('rejects top + full', () => {
    expect(validateAndOrderGarments([garment('top'), garment('full')])).toBeNull();
  });
});

describe('/generate', () => {
  it('rejects missing fields', async () => {
    const res = await handle(post({ device_id: 'd' }), { GEMINI_API_KEY: 'k' }, {
      gemini: makeGemini([]),
      store: null,
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('invalid_body');
  });

  it('rejects modes other than outfit in v1', async () => {
    const res = await handle(post({ ...(validBody() as object), mode: 'hair' }), { GEMINI_API_KEY: 'k' }, {
      gemini: makeGemini([{ inlineData: { mimeType: 'image/png', data: PNG_B64 } }]),
      store: null,
    });
    expect(res.status).toBe(400);
  });

  it('rejects invalid garment combos at the route level', async () => {
    const res = await handle(post(validBody('d', [garment('top'), garment('top')])), { GEMINI_API_KEY: 'k' }, {
      gemini: makeGemini([{ inlineData: { mimeType: 'image/png', data: PNG_B64 } }]),
      store: null,
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('invalid_body');
  });

  it('returns the first inlineData image part', async () => {
    const gem = makeGemini([
      { text: 'here you go' },
      { inlineData: { mimeType: 'image/png', data: PNG_B64 } },
    ]);
    const res = await handle(post(validBody()), { GEMINI_API_KEY: 'k' }, {
      gemini: gem,
      store: null,
      uuid: () => 'gen-uuid',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; image: string; generation_id: string };
    expect(body.ok).toBe(true);
    expect(body.image).toBe(PNG_B64);
    expect(body.generation_id).toBe('gen-uuid');
  });

  it('passes images in canonical order: reference, top, bottom', async () => {
    const gen = vi.fn(async () => [{ inlineData: { mimeType: 'image/png', data: PNG_B64 } }]);
    const gem: GeminiClient = { generate: gen };
    await handle(
      post(validBody('d', [garment('bottom', 'BOT'), garment('top', 'TOP')])),
      { GEMINI_API_KEY: 'k' },
      { gemini: gem, store: null },
    );
    expect(gen).toHaveBeenCalledOnce();
    const call = (gen.mock.calls[0] as unknown as [unknown])[0] as { images: { data: string }[]; prompt: string };
    expect(call.images.map((i) => i.data)).toEqual(['AA', 'TOP', 'BOT']);
    expect(call.prompt).toBe(OUTFIT_TOP_AND_BOTTOM_PROMPT);
  });

  it('uses OUTFIT_TOP_PROMPT for a single top', async () => {
    const gen = vi.fn(async () => [{ inlineData: { mimeType: 'image/png', data: PNG_B64 } }]);
    await handle(post(validBody('d', [garment('top', 'T')])), { GEMINI_API_KEY: 'k' }, {
      gemini: { generate: gen },
      store: null,
    });
    const call = (gen.mock.calls[0] as unknown as [unknown])[0] as { prompt: string };
    expect(call.prompt).toBe(OUTFIT_TOP_PROMPT);
  });

  it('maps safety blocks (text-only response with safety wording)', async () => {
    const gem = makeGemini([{ text: 'Blocked due to safety policy' }]);
    const res = await handle(post(validBody()), { GEMINI_API_KEY: 'k' }, {
      gemini: gem,
      store: null,
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('gemini_safety_block');
  });

  it('maps timeouts to gemini_timeout', async () => {
    const gem: GeminiClient = {
      generate: ({ signal }) =>
        new Promise((_, reject) => {
          signal?.addEventListener('abort', () => {
            const e = new Error('aborted');
            e.name = 'AbortError';
            reject(e);
          });
        }),
    };
    const res = await handle(post(validBody()), { GEMINI_API_KEY: 'k' }, {
      gemini: gem,
      store: null,
      timeoutMs: 10,
    });
    expect(res.status).toBe(504);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('gemini_timeout');
  });

  it('rate-limits the (DAILY_LIMIT+1)th request from the same device in a UTC day', async () => {
    const { DAILY_LIMIT } = await import('./ratelimit');
    const store = new MemStore();
    const gem = makeGemini([{ inlineData: { mimeType: 'image/png', data: PNG_B64 } }]);
    const env = { GEMINI_API_KEY: 'k' };
    for (let i = 0; i < DAILY_LIMIT; i++) {
      const r = await handle(post(validBody('dev-rl')), env, { gemini: gem, store });
      expect(r.status).toBe(200);
    }
    const overflow = await handle(post(validBody('dev-rl')), env, { gemini: gem, store });
    expect(overflow.status).toBe(429);
    expect(overflow.headers.get('X-RateLimit-Remaining')).toBe('0');
    const body = (await overflow.json()) as { code: string };
    expect(body.code).toBe('rate_limited');
  });

  it("rejects accessoriesMode='custom' without any accessory images", async () => {
    const body = { ...(validBody() as Record<string, unknown>), accessoriesMode: 'custom' };
    const res = await handle(post(body), { GEMINI_API_KEY: 'k' }, {
      gemini: makeGemini([{ inlineData: { mimeType: 'image/png', data: PNG_B64 } }]),
      store: null,
    });
    expect(res.status).toBe(400);
    const j = (await res.json()) as { code: string };
    expect(j.code).toBe('invalid_body');
  });

  it("rejects accessoriesMode='custom' with an empty accessories array", async () => {
    const body = {
      ...(validBody() as Record<string, unknown>),
      accessoriesMode: 'custom',
      accessories: [],
    };
    const res = await handle(post(body), { GEMINI_API_KEY: 'k' }, {
      gemini: makeGemini([{ inlineData: { mimeType: 'image/png', data: PNG_B64 } }]),
      store: null,
    });
    expect(res.status).toBe(400);
  });

  it("'custom' mode appends a single accessory image after the garments", async () => {
    const gen = vi.fn(async () => [{ inlineData: { mimeType: 'image/png', data: PNG_B64 } }]);
    const body = {
      ...(validBody() as Record<string, unknown>),
      accessoriesMode: 'custom',
      accessories: [{ image: 'ACC', mime: 'image/jpeg' }],
    };
    await handle(post(body), { GEMINI_API_KEY: 'k' }, { gemini: { generate: gen }, store: null });
    const call = (gen.mock.calls[0] as unknown as [unknown])[0] as {
      images: { data: string }[];
      prompt: string;
    };
    expect(call.images.map((i) => i.data)).toEqual(['AA', 'BB', 'ACC']);
    expect(call.prompt).toContain(ACCESSORY_FROM_IMAGE_CLAUSE);
  });

  it("'custom' mode appends every accessory image in order", async () => {
    const gen = vi.fn(async () => [{ inlineData: { mimeType: 'image/png', data: PNG_B64 } }]);
    const body = {
      ...(validBody() as Record<string, unknown>),
      accessoriesMode: 'custom',
      accessories: [
        { image: 'WATCH', mime: 'image/jpeg' },
        { image: 'GLASSES', mime: 'image/jpeg' },
        { image: 'BAG', mime: 'image/jpeg' },
      ],
    };
    await handle(post(body), { GEMINI_API_KEY: 'k' }, { gemini: { generate: gen }, store: null });
    const call = (gen.mock.calls[0] as unknown as [unknown])[0] as {
      images: { data: string }[];
    };
    expect(call.images.map((i) => i.data)).toEqual(['AA', 'BB', 'WATCH', 'GLASSES', 'BAG']);
  });

  it("'model' mode does not append any accessory image but does append the clause", async () => {
    const gen = vi.fn(async () => [{ inlineData: { mimeType: 'image/png', data: PNG_B64 } }]);
    const body = { ...(validBody() as Record<string, unknown>), accessoriesMode: 'model' };
    await handle(post(body), { GEMINI_API_KEY: 'k' }, { gemini: { generate: gen }, store: null });
    const call = (gen.mock.calls[0] as unknown as [unknown])[0] as {
      images: { data: string }[];
      prompt: string;
    };
    expect(call.images).toHaveLength(2);
    expect(call.prompt).toContain(ACCESSORY_FROM_MODEL_CLAUSE);
  });

  it('returns 500 if no API key and no override', async () => {
    const res = await handle(post(validBody()), {}, {} as Partial<GenerateDeps>);
    expect(res.status).toBe(500);
  });
});

describe('/generate (hair mode)', () => {
  function hairBody(deviceId = 'dev-h'): unknown {
    return {
      device_id: deviceId,
      mode: 'hair',
      reference_photo: 'FACE',
      reference_mime: 'image/jpeg',
      hair_source: { image: 'CUT', mime: 'image/jpeg' },
    };
  }

  it("rejects mode='hair' without hair_source", async () => {
    const body = { ...(hairBody() as Record<string, unknown>) };
    delete body.hair_source;
    const res = await handle(post(body), { GEMINI_API_KEY: 'k' }, {
      gemini: makeGemini([{ inlineData: { mimeType: 'image/png', data: PNG_B64 } }]),
      store: null,
    });
    expect(res.status).toBe(400);
    const j = (await res.json()) as { code: string };
    expect(j.code).toBe('invalid_body');
  });

  it("rejects mode='blend' (deferred)", async () => {
    const body = { ...(hairBody() as Record<string, unknown>), mode: 'blend' };
    const res = await handle(post(body), { GEMINI_API_KEY: 'k' }, {
      gemini: makeGemini([{ inlineData: { mimeType: 'image/png', data: PNG_B64 } }]),
      store: null,
    });
    expect(res.status).toBe(400);
  });

  it("'hair' uses HAIR_PROMPT and sends [reference, hair_source] in order", async () => {
    const gen = vi.fn(async () => [{ inlineData: { mimeType: 'image/png', data: PNG_B64 } }]);
    await handle(post(hairBody()), { GEMINI_API_KEY: 'k' }, {
      gemini: { generate: gen },
      store: null,
    });
    const call = (gen.mock.calls[0] as unknown as [unknown])[0] as {
      images: { data: string }[];
      prompt: string;
    };
    expect(call.images.map((i) => i.data)).toEqual(['FACE', 'CUT']);
    expect(call.prompt).toBe(HAIR_PROMPT);
  });

  it('hair mode returns the generated image like outfit mode', async () => {
    const res = await handle(post(hairBody()), { GEMINI_API_KEY: 'k' }, {
      gemini: makeGemini([{ inlineData: { mimeType: 'image/png', data: PNG_B64 } }]),
      store: null,
      uuid: () => 'gen-h',
    });
    expect(res.status).toBe(200);
    const j = (await res.json()) as { ok: boolean; image: string; generation_id: string };
    expect(j.ok).toBe(true);
    expect(j.image).toBe(PNG_B64);
    expect(j.generation_id).toBe('gen-h');
  });
});

describe('router', () => {
  it('still handles /health', async () => {
    const res = await handle(new Request('https://x.test/health'), {});
    expect(await res.json()).toEqual({ ok: true });
  });
});
