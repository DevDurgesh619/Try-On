# Chrome Web Store submission — copy + assets

Drop this content into the corresponding fields in the
[Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole).

## Listing details

### Item name (max 75 chars)
```
TryOn — see clothes & hairstyles on yourself, in one click
```

### Summary / short description (max 132 chars)
```
Try clothes from Myntra, Amazon, Flipkart, Pinterest — and hairstyles from anywhere — on your own photo. One click. Stays on-device.
```

### Detailed description (max ~16,000 chars; aim for ~250 words)
```
TryOn is a Chrome extension that lets you try clothes and hairstyles on your own photo while you shop online — in a single click.

Browsing Myntra, Amazon Fashion, Flipkart, or Pinterest? Hover any product image and a "Try on" button appears. Click it. Within ~15 seconds, you see yourself wearing the item — your face, body, and lighting preserved. Download it, share with a friend, or hit Regenerate for a different angle.

Right-click any image on any other site and pick "Try this on with TryOn" for the same flow.

Why it's different:
• Three things in one image — outfit, accessory, AND hairstyle. Pick a top from Myntra, a hairstyle from a Pinterest pin, an accessory from anywhere — TryOn combines them naturally.
• Slot picker — pick what slot the next image fills (Top / Bottom / Accessory / Hairstyle). No guessing where your click will land.
• Stays on your device — your reference photos never get uploaded to our servers. They live in chrome.storage.local on your machine. The only time a photo leaves your device is the single transient API call to Google's Gemini model.
• Free during beta — 5 free try-ons anonymous, 5 more after a one-click Google sign-in. Paid plans coming soon.

Powered by Google's Nano Banana 2 (gemini-3.1-flash-image-preview), an image model with strong identity preservation. The result keeps your face, expression, body shape, and the photo's lighting — only the clothes/accessories/hair change.

Privacy policy: https://tryon-9z6.pages.dev/privacy
Terms: https://tryon-9z6.pages.dev/terms
```

### Category
`Shopping`

### Language
`English (United States)` (and optionally `English (India)`)

---

## Single-purpose declaration
```
TryOn lets shoppers see how clothes and hairstyles would look on themselves before buying, by overlaying images they pick from shopping or inspiration sites onto their own reference photo using Google's Gemini AI model.
```

## Justifications for permissions

**`sidePanel`**
> The extension's main UI lives in the Chrome side panel — the result viewer, reference-photo manager, account chip, and settings. Required.

**`storage`**
> Persists the user's reference photos, recent results, anonymous device ID, and auth tokens in chrome.storage.local. Photos stay on-device.

**`contextMenus`**
> Adds three right-click entries on `<img>` elements: "Try this on with TryOn" (garment), "Use as accessory in TryOn" (accessory), "Use this hairstyle in TryOn" (hair). The universal escape hatch when the hover button isn't available.

**`activeTab`**
> Used to open the side panel from the action button (`chrome.action.onClicked`). Required by the MV3 side panel API.

**`scripting`**
> Re-injects the content script into already-open tabs after the extension is installed or reloaded, so the user doesn't have to manually refresh every shopping tab.

**`tabs`**
> Used with `chrome.tabs.query` to find matching open tabs for the re-inject flow above.

**`identity`**
> One-click Google sign-in via `chrome.identity.getAuthToken`. Used to grant signed-in users 5 additional free credits and let them sync usage across devices. No password handling.

## Justifications for host_permissions

**`https://*.myntra.com/*`**
> Tuned site adapter to detect product images and inject the hover "Try on" button on Myntra product pages. Required to fetch the source image when the user clicks Generate (the request body must include the image, not just the URL).

**`https://*.amazon.in/*`**
> Same as above for Amazon Fashion India.

**`https://*.flipkart.com/*`**
> Same as above for Flipkart.

**`https://*.pinterest.com/*`**
> Pinterest is the primary discovery surface for hairstyle references. Hover button injected on pin pages so users can pick a hairstyle in one click.

**`https://*.pinimg.com/*`**
> Pinterest's image CDN. Required so the service worker can fetch the actual image bytes when a user clicks Try-on on a Pinterest pin.

**`http://localhost/*` and `http://127.0.0.1/*`**
> Used during local development to point the extension at a local Cloudflare Worker (`wrangler dev`). Stripped from production builds.

**`https://*.workers.dev/*`**
> The Cloudflare Worker that proxies Google's Gemini API. Required because the API key never lives in the extension; it lives only as a Worker secret.

---

## Screenshots checklist

Submit 5 PNG screenshots at 1280×800. Save them in `cws-assets/screenshots/`:

1. **`01-side-panel-with-result.png`** — Show the Outfit tab on Myntra mid-flow, with a generated result visible. The "wow moment."
2. **`02-target-picker.png`** — Show the slot picker with multiple targets visible (Full / Top / Bottom / Accessory / Hairstyle). Demonstrates the unique "pick what slot the next click fills" UX.
3. **`03-pinterest-hover.png`** — Show the "Try on" hover button on a Pinterest pin (hairstyle). Demonstrates the universal-website coverage.
4. **`04-hair-tab.png`** — Show the Hair tab with face photo + hairstyle source filled in.
5. **`05-account-chip.png`** — Show the account chip with email + credits-remaining badge after Google sign-in.

The first screenshot drives ~80% of click-throughs from the Web Store listing — make it the most polished one.

## Icons checklist

- `icon-128.png` — 128×128 PNG. Required for the listing.
- `icon-48.png`, `icon-16.png` — optional but recommended for the toolbar action.

If you don't have a designer, [Fiverr](https://fiverr.com) has decent ones for ~$20.

## Demo video (optional but doubles install rate)

Record a 30-second screencast on YouTube:
- 0–5s: Browsing Myntra, hover a product, see the "Try on" button.
- 5–15s: Click → loading → result appears.
- 15–25s: Switch to Hair tab, drop a Pinterest hairstyle, generate.
- 25–30s: Show the final image with both outfit + hair.

Upload to YouTube as Unlisted, paste the URL into the listing's "Promotional video" field.

---

## Pre-submission checks

- [ ] Privacy policy URL (`https://tryon-9z6.pages.dev/privacy`) is publicly reachable.
- [ ] Terms URL is publicly reachable.
- [ ] `manifest.json` has `oauth2.client_id` set to the production Google OAuth client ID (NOT the dev/unpacked one — Google rejects this).
- [ ] Production build uses the prod Worker URL, not localhost.
- [ ] All 86 backend tests + 68 extension tests green.
- [ ] D1 migration has been run on the production database.
- [ ] `wrangler secret put GEMINI_API_KEY`, `JWT_SIGNING_KEY`, `REFRESH_SIGNING_KEY` all set on the production Worker.
- [ ] Manual end-to-end smoke test: install dist/, complete onboarding, sign in with Google, generate a result, hit the paywall after 10 generations.
