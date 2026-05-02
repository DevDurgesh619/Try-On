import { describe, it, expect, vi } from 'vitest';
import { callGenerate } from './backend';

const baseUrl = 'http://test';
const input = {
  mode: 'outfit' as const,
  device_id: 'd',
  reference_photo_b64: 'AA',
  reference_mime: 'image/jpeg',
  garments: [{ slot: 'full' as const, image_b64: 'BB', mime: 'image/jpeg' }],
  accessoriesMode: 'off' as const,
};

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('callGenerate', () => {
  it('returns ok payload on 200', async () => {
    const fetcher = vi.fn(async () =>
      jsonRes({
        ok: true,
        image: 'IMG',
        mime_type: 'image/png',
        generation_id: 'g1',
        ms_taken: 1234,
      }),
    );
    const r = await callGenerate(input, { fetch: fetcher, baseUrl, retries: 0 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.image_b64).toBe('IMG');
      expect(r.generation_id).toBe('g1');
    }
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('retries once on 5xx then succeeds', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(jsonRes({ ok: false, code: 'backend_error', message: 'boom' }, 503))
      .mockResolvedValueOnce(
        jsonRes({ ok: true, image: 'IMG', mime_type: 'image/png', generation_id: 'g', ms_taken: 1 }),
      );
    const r = await callGenerate(input, {
      fetch: fetcher,
      baseUrl,
      retries: 1,
      sleep: async () => undefined,
    });
    expect(r.ok).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('does not retry 4xx; surfaces remote error code', async () => {
    const fetcher = vi.fn(async () =>
      jsonRes({ ok: false, code: 'rate_limited', message: 'limit' }, 429),
    );
    const r = await callGenerate(input, { fetch: fetcher, baseUrl, retries: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('rate_limited');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('surfaces fetch network errors as backend_error after retries', async () => {
    const fetcher = vi.fn(async () => {
      throw new Error('econnrefused');
    });
    const r = await callGenerate(input, {
      fetch: fetcher,
      baseUrl,
      retries: 1,
      sleep: async () => undefined,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('backend_error');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('maps gemini_safety_block through', async () => {
    const fetcher = vi.fn(async () =>
      jsonRes({ ok: false, code: 'gemini_safety_block', message: 'safety' }, 422),
    );
    const r = await callGenerate(input, { fetch: fetcher, baseUrl, retries: 0 });
    if (!r.ok) expect(r.code).toBe('gemini_safety_block');
  });
});
