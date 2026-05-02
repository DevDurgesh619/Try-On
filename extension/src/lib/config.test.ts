import { describe, it, expect } from 'vitest';
import { getWorkerConfig } from './config';

describe('getWorkerConfig', () => {
  it('returns a baseUrl', () => {
    const cfg = getWorkerConfig();
    expect(cfg.baseUrl).toMatch(/^https?:\/\//);
  });
});
