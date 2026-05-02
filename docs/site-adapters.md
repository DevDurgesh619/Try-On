# Site Adapters

Each supported shopping site has a tuned adapter that knows how to find the primary product image on a product page. For unsupported sites we fall back to right-click → "Try this on."

## Adapter interface

```ts
// extension/src/adapters/types.ts
export interface ProductMeta {
  title: string | null;
  brand: string | null;
  productType: string | null; // e.g. "kurta", "shirt", "jeans"
}

export interface SiteAdapter {
  /** Hostname matcher. */
  hostMatch: RegExp;

  /** The single best product image to try on. Usually the largest one in the gallery. */
  getPrimaryProductImage(doc: Document): string | null;

  /** All product images (for the gallery picker, post-MVP). */
  getAllProductImages(doc: Document): string[];

  /** Optional metadata for prompt enrichment. */
  getProductMeta(doc: Document): ProductMeta | null;
}
```

## Selectors

> **Warning:** Site DOMs change. Treat these as a starting point and verify on a real page before shipping. The Worker's `/health` endpoint pings each adapter daily and reports breakage.

### Myntra (`myntra.com`)
- **Primary image:** `.image-grid-image` first child, read `style` attribute and parse the `url(...)` (Myntra uses background-image divs, not `<img>`)
- **All gallery images:** `.image-grid-image` (multiple)
- **Title:** `.pdp-title` text content
- **Brand:** `.pdp-name` text content (yes, the names are reversed in their DOM)
- **Product type:** parse from `.pdp-product-type-text` or fall back to title

### Amazon Fashion India (`amazon.in`)
- **Primary image:** `#landingImage` `src` attribute, or `data-old-hires` for high-res
- **All gallery images:** `#altImages li img` then strip the thumbnail `_SS40_` from the URL
- **Title:** `#productTitle` text content (trim it, Amazon pads with whitespace)
- **Brand:** `#bylineInfo` text content, strip leading "Visit the " or "Brand: "
- **Product type:** breadcrumbs `#wayfinding-breadcrumbs_feature_div ul li:last-child a`

### Flipkart (`flipkart.com`)
- **Primary image:** `img[class*="_396cs4"]` `src` attribute, or fallback to the first `img` inside `[data-slot]`
- **All gallery images:** `[class*="_2amPTt"] img` (the thumbnail strip)
- **Title:** `[class*="_35KyD6"]` or `h1` inside `._30jeq3` parent
- **Brand:** Same `h1`, first span
- **Product type:** breadcrumbs `[class*="_3GIHBu"] a`

> Flipkart obfuscates class names. The selectors above worked at the time of writing but **must be re-validated** on first run. Build the adapter to log warnings and degrade gracefully if a selector returns null.

## Universal fallback

For any site not in the list above:
- No content script auto-detection.
- Right-click context menu adds "Try this on with TryOn" only on `<img>` elements (use `chrome.contextMenus.create` with `contexts: ['image']`).
- The image's `srcUrl` from the menu click event is what we use.

## Adding a new site adapter

1. Create `extension/src/adapters/<site>.ts` exporting a `SiteAdapter`.
2. Register it in `extension/src/adapters/index.ts`.
3. Add the host to `manifest.json` `host_permissions` and `content_scripts.matches`.
4. Add unit tests in `extension/src/adapters/<site>.test.ts` using saved HTML fixtures in `extension/tests/fixtures/<site>/`.
5. Update this doc with the selectors used.

## Image extraction notes

- Always resolve relative URLs against the document base before returning.
- Prefer the highest-resolution version available. Many sites serve thumbnails first; check for `data-zoom-image`, `data-old-hires`, `srcset`, or background-image patterns.
- If the image URL is a CDN with size params (e.g., Myntra's `_assets/images/.../h_1080,w_864...`), normalize to a high-res variant before sending.
- Do not extract more than what the user asked for. No background image scraping.
