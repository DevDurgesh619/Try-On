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
  HAIR_IN_OUTFIT_CLAUSE,
  HAIR_PROMPT,
  OUTFIT_BOTTOM_PROMPT,
  OUTFIT_FULL_PROMPT,
  OUTFIT_TOP_AND_BOTTOM_PROMPT,
  OUTFIT_TOP_PROMPT,
} from './prompts';
import { createMemoryDb } from './db.test-helpers';
import { ANON_FREE_CREDITS } from './db';

const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

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
      db: null,
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('invalid_body');
  });

  it('rejects modes other than outfit in v1', async () => {
    const res = await handle(post({ ...(validBody() as object), mode: 'hair' }), { GEMINI_API_KEY: 'k' }, {
      gemini: makeGemini([{ inlineData: { mimeType: 'image/png', data: PNG_B64 } }]),
      db: null,
    });
    expect(res.status).toBe(400);
  });

  it('rejects invalid garment combos at the route level', async () => {
    const res = await handle(post(validBody('d', [garment('top'), garment('top')])), { GEMINI_API_KEY: 'k' }, {
      gemini: makeGemini([{ inlineData: { mimeType: 'image/png', data: PNG_B64 } }]),
      db: null,
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
      db: null,
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
      { gemini: gem, db: null },
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
      db: null,
    });
    const call = (gen.mock.calls[0] as unknown as [unknown])[0] as { prompt: string };
    expect(call.prompt).toBe(OUTFIT_TOP_PROMPT);
  });

  it('maps safety blocks (text-only response with safety wording)', async () => {
    const gem = makeGemini([{ text: 'Blocked due to safety policy' }]);
    const res = await handle(post(validBody()), { GEMINI_API_KEY: 'k' }, {
      gemini: gem,
      db: null,
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('gemini_safety_block');
  });

  it('retries once on empty parts and succeeds on second attempt (Layer 2 stochastic block)', async () => {
    const gen = vi
      .fn<() => Promise<GeminiPart[]>>()
      .mockResolvedValueOnce([]) // first attempt: blockReason=OTHER, empty parts
      .mockResolvedValueOnce([{ inlineData: { mimeType: 'image/png', data: PNG_B64 } }]);
    const res = await handle(post(validBody()), { GEMINI_API_KEY: 'k' }, {
      gemini: { generate: gen },
      db: null,
      retryDelayMs: 0,
    });
    expect(res.status).toBe(200);
    expect(gen).toHaveBeenCalledTimes(2);
    const body = (await res.json()) as { ok: boolean; image: string };
    expect(body.ok).toBe(true);
    expect(body.image).toBe(PNG_B64);
  });

  it('returns gemini_no_image after all retry attempts fail with empty parts', async () => {
    const gen = vi.fn<() => Promise<GeminiPart[]>>().mockResolvedValue([]);
    const res = await handle(post(validBody()), { GEMINI_API_KEY: 'k' }, {
      gemini: { generate: gen },
      db: null,
      retryDelayMs: 0,
    });
    expect(res.status).toBe(502);
    expect(gen).toHaveBeenCalledTimes(2);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('gemini_no_image');
  });

  it('does NOT retry on safety block (deterministic)', async () => {
    const gen = vi
      .fn<() => Promise<GeminiPart[]>>()
      .mockResolvedValue([{ text: 'Blocked due to safety policy' }]);
    const res = await handle(post(validBody()), { GEMINI_API_KEY: 'k' }, {
      gemini: { generate: gen },
      db: null,
      retryDelayMs: 0,
    });
    expect(res.status).toBe(422);
    expect(gen).toHaveBeenCalledTimes(1);
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
      db: null,
      timeoutMs: 10,
    });
    expect(res.status).toBe(504);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('gemini_timeout');
  });

  it('anonymous device gets ANON_FREE_CREDITS, then out_of_credits on the next request', async () => {
    const { db } = createMemoryDb();
    const gem = makeGemini([{ inlineData: { mimeType: 'image/png', data: PNG_B64 } }]);
    const env = { GEMINI_API_KEY: 'k' };
    for (let i = 0; i < ANON_FREE_CREDITS; i++) {
      const r = await handle(post(validBody('dev-rl')), env, { gemini: gem, db });
      expect(r.status).toBe(200);
    }
    const overflow = await handle(post(validBody('dev-rl')), env, { gemini: gem, db });
    expect(overflow.status).toBe(402);
    const body = (await overflow.json()) as { code: string };
    expect(body.code).toBe('out_of_credits');
  });

  it("rejects accessoriesMode='custom' without any accessory images", async () => {
    const body = { ...(validBody() as Record<string, unknown>), accessoriesMode: 'custom' };
    const res = await handle(post(body), { GEMINI_API_KEY: 'k' }, {
      gemini: makeGemini([{ inlineData: { mimeType: 'image/png', data: PNG_B64 } }]),
      db: null,
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
      db: null,
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
    await handle(post(body), { GEMINI_API_KEY: 'k' }, { gemini: { generate: gen }, db: null });
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
    await handle(post(body), { GEMINI_API_KEY: 'k' }, { gemini: { generate: gen }, db: null });
    const call = (gen.mock.calls[0] as unknown as [unknown])[0] as {
      images: { data: string }[];
    };
    expect(call.images.map((i) => i.data)).toEqual(['AA', 'BB', 'WATCH', 'GLASSES', 'BAG']);
  });

  it("'model' mode does not append any accessory image but does append the clause", async () => {
    const gen = vi.fn(async () => [{ inlineData: { mimeType: 'image/png', data: PNG_B64 } }]);
    const body = { ...(validBody() as Record<string, unknown>), accessoriesMode: 'model' };
    await handle(post(body), { GEMINI_API_KEY: 'k' }, { gemini: { generate: gen }, db: null });
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
      db: null,
    });
    expect(res.status).toBe(400);
    const j = (await res.json()) as { code: string };
    expect(j.code).toBe('invalid_body');
  });

  it("rejects mode='blend' (deferred)", async () => {
    const body = { ...(hairBody() as Record<string, unknown>), mode: 'blend' };
    const res = await handle(post(body), { GEMINI_API_KEY: 'k' }, {
      gemini: makeGemini([{ inlineData: { mimeType: 'image/png', data: PNG_B64 } }]),
      db: null,
    });
    expect(res.status).toBe(400);
  });

  it("'hair' uses HAIR_PROMPT and sends [reference, hair_source] in order", async () => {
    const gen = vi.fn(async () => [{ inlineData: { mimeType: 'image/png', data: PNG_B64 } }]);
    await handle(post(hairBody()), { GEMINI_API_KEY: 'k' }, {
      gemini: { generate: gen },
      db: null,
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
      db: null,
      uuid: () => 'gen-h',
    });
    expect(res.status).toBe(200);
    const j = (await res.json()) as { ok: boolean; image: string; generation_id: string };
    expect(j.ok).toBe(true);
    expect(j.image).toBe(PNG_B64);
    expect(j.generation_id).toBe('gen-h');
  });
});

describe('/generate (outfit + hair source)', () => {
  function outfitHairBody(extra: Record<string, unknown> = {}): unknown {
    return {
      ...(validBody() as Record<string, unknown>),
      hair_source: { image: 'CUT', mime: 'image/jpeg' },
      ...extra,
    };
  }

  it('appends the hair source as the LAST image (after the reference + garment)', async () => {
    const gen = vi.fn(async () => [{ inlineData: { mimeType: 'image/png', data: PNG_B64 } }]);
    await handle(post(outfitHairBody()), { GEMINI_API_KEY: 'k' }, {
      gemini: { generate: gen },
      db: null,
    });
    const call = (gen.mock.calls[0] as unknown as [unknown])[0] as {
      images: { data: string }[];
      prompt: string;
    };
    expect(call.images.map((i) => i.data)).toEqual(['AA', 'BB', 'CUT']);
    expect(call.prompt).toContain(HAIR_IN_OUTFIT_CLAUSE);
    expect(call.prompt.endsWith('- The output must be a single image. Do not return text.')).toBe(true);
  });

  it('hair clause comes AFTER the accessory clause when both present, and accessory image comes BEFORE hair image', async () => {
    const gen = vi.fn(async () => [{ inlineData: { mimeType: 'image/png', data: PNG_B64 } }]);
    await handle(
      post(outfitHairBody({
        accessoriesMode: 'custom',
        accessories: [{ image: 'WATCH', mime: 'image/jpeg' }],
      })),
      { GEMINI_API_KEY: 'k' },
      { gemini: { generate: gen }, db: null },
    );
    const call = (gen.mock.calls[0] as unknown as [unknown])[0] as {
      images: { data: string }[];
      prompt: string;
    };
    expect(call.images.map((i) => i.data)).toEqual(['AA', 'BB', 'WATCH', 'CUT']);
    const accIdx = call.prompt.indexOf(ACCESSORY_FROM_IMAGE_CLAUSE);
    const hairIdx = call.prompt.indexOf(HAIR_IN_OUTFIT_CLAUSE);
    expect(accIdx).toBeGreaterThan(-1);
    expect(hairIdx).toBeGreaterThan(accIdx);
  });

  it('hair_source works alongside accessoriesMode=model (clause but no extra image)', async () => {
    const gen = vi.fn(async () => [{ inlineData: { mimeType: 'image/png', data: PNG_B64 } }]);
    await handle(
      post(outfitHairBody({ accessoriesMode: 'model' })),
      { GEMINI_API_KEY: 'k' },
      { gemini: { generate: gen }, db: null },
    );
    const call = (gen.mock.calls[0] as unknown as [unknown])[0] as {
      images: { data: string }[];
      prompt: string;
    };
    expect(call.images.map((i) => i.data)).toEqual(['AA', 'BB', 'CUT']);
    expect(call.prompt).toContain(ACCESSORY_FROM_MODEL_CLAUSE);
    expect(call.prompt).toContain(HAIR_IN_OUTFIT_CLAUSE);
  });

  it('without hair_source the prompt does NOT contain the hair clause and image count is unchanged', async () => {
    const gen = vi.fn(async () => [{ inlineData: { mimeType: 'image/png', data: PNG_B64 } }]);
    await handle(post(validBody()), { GEMINI_API_KEY: 'k' }, {
      gemini: { generate: gen },
      db: null,
    });
    const call = (gen.mock.calls[0] as unknown as [unknown])[0] as {
      images: { data: string }[];
      prompt: string;
    };
    expect(call.images).toHaveLength(2);
    expect(call.prompt).not.toContain(HAIR_IN_OUTFIT_CLAUSE);
  });

  it('rejects a malformed hair_source on outfit body (silently drops, prompt has no hair clause)', async () => {
    const gen = vi.fn(async () => [{ inlineData: { mimeType: 'image/png', data: PNG_B64 } }]);
    const body = { ...(validBody() as Record<string, unknown>), hair_source: { image: '' } };
    await handle(post(body), { GEMINI_API_KEY: 'k' }, {
      gemini: { generate: gen },
      db: null,
    });
    const call = (gen.mock.calls[0] as unknown as [unknown])[0] as { prompt: string };
    expect(call.prompt).not.toContain(HAIR_IN_OUTFIT_CLAUSE);
  });

  it('two-garment outfit + hair_source orders images [ref, top, bottom, hair]', async () => {
    const gen = vi.fn(async () => [{ inlineData: { mimeType: 'image/png', data: PNG_B64 } }]);
    const body = {
      ...(validBody('d', [garment('bottom', 'BOT'), garment('top', 'TOP')]) as Record<string, unknown>),
      hair_source: { image: 'CUT', mime: 'image/jpeg' },
    };
    await handle(post(body), { GEMINI_API_KEY: 'k' }, { gemini: { generate: gen }, db: null });
    const call = (gen.mock.calls[0] as unknown as [unknown])[0] as {
      images: { data: string }[];
    };
    expect(call.images.map((i) => i.data)).toEqual(['AA', 'TOP', 'BOT', 'CUT']);
  });
});

describe('buildPrompt (hair-in-outfit)', () => {
  it('appends only hair clause when accessoriesMode=off and hasHairSource=true', () => {
    const out = buildPrompt(OUTFIT_FULL_PROMPT, 'off', true);
    expect(out).toContain(HAIR_IN_OUTFIT_CLAUSE);
    expect(out).not.toContain(ACCESSORY_FROM_MODEL_CLAUSE);
    expect(out).not.toContain(ACCESSORY_FROM_IMAGE_CLAUSE);
    expect(out.endsWith('- The output must be a single image. Do not return text.')).toBe(true);
  });
  it('omits hair clause when hasHairSource=false (default)', () => {
    expect(buildPrompt(OUTFIT_FULL_PROMPT, 'off')).toBe(OUTFIT_FULL_PROMPT);
    expect(buildPrompt(OUTFIT_FULL_PROMPT, 'model')).not.toContain(HAIR_IN_OUTFIT_CLAUSE);
  });
});

describe('router', () => {
  it('still handles /health', async () => {
    const res = await handle(new Request('https://x.test/health'), {});
    expect(await res.json()).toEqual({ ok: true });
  });
});
