import { describe, it, expect } from 'vitest';
import { getOrCreateDeviceId } from './device-id';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('getOrCreateDeviceId', () => {
  it('creates a UUIDv4 on first call', async () => {
    const id = await getOrCreateDeviceId();
    expect(id).toMatch(UUID_RE);
  });

  it('returns the same id on subsequent calls', async () => {
    const a = await getOrCreateDeviceId();
    const b = await getOrCreateDeviceId();
    expect(b).toBe(a);
  });
});
