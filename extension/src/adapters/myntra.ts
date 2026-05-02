import type { ProductMeta, SiteAdapter } from './types';
import { parseBackgroundImageUrl, resolveUrl, trimOrNull, warnMissing } from './util';

const NAME = 'myntra';

function getGridImageUrls(doc: Document): string[] {
  const els = Array.from(doc.querySelectorAll<HTMLElement>('.image-grid-image'));
  const urls: string[] = [];
  for (const el of els) {
    const url = parseBackgroundImageUrl(el.getAttribute('style'));
    const resolved = resolveUrl(url, doc);
    if (resolved) urls.push(resolved);
  }
  return urls;
}

export const myntraAdapter: SiteAdapter = {
  name: NAME,
  hostMatch: /(^|\.)myntra\.com$/i,

  getPrimaryProductImage(doc) {
    const urls = getGridImageUrls(doc);
    if (urls.length === 0) {
      warnMissing(NAME, '.image-grid-image');
      return null;
    }
    return urls[0] ?? null;
  },

  getAllProductImages(doc) {
    return getGridImageUrls(doc);
  },

  getProductMeta(doc): ProductMeta | null {
    // NOTE: Myntra reverses these in their DOM — `.pdp-name` is brand, `.pdp-title` is title.
    const title = trimOrNull(doc.querySelector('.pdp-title')?.textContent);
    const brand = trimOrNull(doc.querySelector('.pdp-name')?.textContent);
    const productType =
      trimOrNull(doc.querySelector('.pdp-product-type-text')?.textContent) ?? title;
    if (!title && !brand && !productType) return null;
    return { title, brand, productType };
  },
};
