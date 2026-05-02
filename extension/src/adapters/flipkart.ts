import type { ProductMeta, SiteAdapter } from './types';
import { resolveUrl, trimOrNull, warnMissing } from './util';

const NAME = 'flipkart';

export const flipkartAdapter: SiteAdapter = {
  name: NAME,
  hostMatch: /(^|\.)flipkart\.com$/i,

  getPrimaryProductImage(doc) {
    // Flipkart obfuscates class names; selectors must be re-validated periodically.
    const primary = doc.querySelector<HTMLImageElement>('img[class*="_396cs4"]');
    if (primary?.getAttribute('src')) return resolveUrl(primary.getAttribute('src'), doc);
    const fallback = doc.querySelector<HTMLImageElement>('[data-slot] img');
    if (fallback?.getAttribute('src')) return resolveUrl(fallback.getAttribute('src'), doc);
    warnMissing(NAME, 'img[class*="_396cs4"] or [data-slot] img');
    return null;
  },

  getAllProductImages(doc) {
    const thumbs = Array.from(doc.querySelectorAll<HTMLImageElement>('[class*="_2amPTt"] img'));
    const urls: string[] = [];
    for (const t of thumbs) {
      const resolved = resolveUrl(t.getAttribute('src'), doc);
      if (resolved) urls.push(resolved);
    }
    return urls;
  },

  getProductMeta(doc): ProductMeta | null {
    const title = trimOrNull(doc.querySelector('[class*="_35KyD6"]')?.textContent);
    const brand = trimOrNull(doc.querySelector('h1 span')?.textContent);
    const productType = trimOrNull(
      doc.querySelector('[class*="_3GIHBu"] a:last-child')?.textContent,
    );
    if (!title && !brand && !productType) return null;
    return { title, brand, productType };
  },
};
