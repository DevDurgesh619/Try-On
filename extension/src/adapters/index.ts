import { amazonAdapter } from './amazon';
import { flipkartAdapter } from './flipkart';
import { myntraAdapter } from './myntra';
import type { SiteAdapter } from './types';

export const ADAPTERS: readonly SiteAdapter[] = [myntraAdapter, amazonAdapter, flipkartAdapter];

export function findAdapter(host: string): SiteAdapter | null {
  for (const a of ADAPTERS) {
    if (a.hostMatch.test(host)) return a;
  }
  return null;
}
