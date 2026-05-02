import type { ProductMeta, SiteAdapter } from './types';
import { resolveUrl, trimOrNull, warnMissing } from './util';

const NAME = 'amazon';

function pickHighRes(img: HTMLImageElement | null): string | null {
  if (!img) return null;
  return img.getAttribute('data-old-hires') || img.getAttribute('src');
}

function stripAmazonThumbSize(url: string): string {
  // Amazon thumbnails embed `_SS40_` (or similar size hints) in the path. Stripping yields the full image.
  return url.replace(/\._[A-Z]+\d+_\./g, '.');
}

export const amazonAdapter: SiteAdapter = {
  name: NAME,
  hostMatch: /(^|\.)amazon\.in$/i,

  getPrimaryProductImage(doc) {
    const img = doc.querySelector<HTMLImageElement>('#landingImage');
    const raw = pickHighRes(img);
    if (!raw) {
      warnMissing(NAME, '#landingImage');
      return null;
    }
    return resolveUrl(raw, doc);
  },

  getAllProductImages(doc) {
    const thumbs = Array.from(doc.querySelectorAll<HTMLImageElement>('#altImages li img'));
    const urls: string[] = [];
    for (const t of thumbs) {
      const raw = t.getAttribute('src');
      if (!raw) continue;
      const resolved = resolveUrl(stripAmazonThumbSize(raw), doc);
      if (resolved) urls.push(resolved);
    }
    return urls;
  },

  getProductMeta(doc): ProductMeta | null {
    const title = trimOrNull(doc.querySelector('#productTitle')?.textContent);
    const rawBrand = trimOrNull(doc.querySelector('#bylineInfo')?.textContent);
    const brand = rawBrand ? rawBrand.replace(/^(Visit the |Brand:\s*)/, '').trim() : null;
    const productType = trimOrNull(
      doc.querySelector('#wayfinding-breadcrumbs_feature_div ul li:last-child a')?.textContent,
    );
    if (!title && !brand && !productType) return null;
    return { title, brand, productType };
  },
};
