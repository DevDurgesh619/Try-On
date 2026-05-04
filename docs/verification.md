# Verification

How to know the code actually works. Claude must run through the relevant checklist before declaring a feature done. "It compiles" is not done.

## Universal pre-flight (every PR)

```bash
cd extension && pnpm typecheck && pnpm lint && pnpm test
cd ../backend && pnpm typecheck && pnpm lint && pnpm test
```

All must pass. Zero warnings, zero skipped tests without a `// TODO(name): why` comment.

## Mode 1 — Outfit Try-On (the v1 milestone)

### Automated checks
- `pnpm test` in `extension/` covers:
  - Each site adapter against saved HTML fixtures returns the correct primary image URL.
  - Storage helper enforces the 4-photo / 20-result / 1024px limits.
  - Message routing in the service worker handles all defined message types and rejects unknown ones.
- `pnpm test` in `backend/` covers:
  - `/generate` rejects requests missing `device_id` or images.
  - Rate limiter blocks the 6th request from the same `device_id` in a UTC day.
  - Gemini error responses (safety block, timeout) are mapped to the correct user-facing error codes.

### Manual smoke test (run before saying "done")
Test on a real Myntra product page end-to-end. Use the placeholder image mode (`use_placeholder_images: true`) to avoid burning API credits during development; only flip to live for the final check.

1. Fresh Chrome profile, install the unpacked extension from `extension/dist/`.
2. Open the side panel — onboarding screen appears.
3. Upload a sample full-body photo. Confirm it's saved (close and reopen the panel — photo persists).
4. Navigate to a real Myntra product page (e.g., a kurta).
5. Click the extension icon. Confirm the side panel opens and shows the auto-detected product image.
6. Click **Try it on**.
7. Confirm:
   - Loading skeleton appears immediately.
   - Result returns within 15 seconds.
   - Result image is downloaded successfully via the **Download** button.
   - **Regenerate** produces a different result.
8. Right-click any random `<img>` on the page → confirm "Try this on with TryOn" appears in the context menu and works.
9. Open DevTools → Application → Storage → Local Storage. Confirm:
   - `device_id` is set (UUIDv4 format).
   - `reference_photos` contains the uploaded photo as a data URL.
   - **No** Gemini API key anywhere.
10. Open DevTools → Network. Confirm:
    - The only outbound request related to generation goes to the Worker URL.
    - The request body contains the reference photo and source image as base64.
    - **No** request goes directly to `generativelanguage.googleapis.com` from the extension.

### Cross-site smoke test
Repeat steps 4–7 on:
- An Amazon Fashion India product page
- A Flipkart product page
- A non-supported site (e.g., a small Shopify boutique) using the right-click flow

Each should produce a usable result.

### Cost & latency check
After each successful manual generation, check the Worker logs:
- `ms_taken` should be < 12000 (12 seconds) at the median.
- Cost per call should be ~$0.045–0.067 (Nano Banana 2 at 1K). Anything wildly different means the request shape is wrong.

## Mode 2 — Hair & Beard (v1.1)
*(Skip until v1.1.)* Same structure as Mode 1, plus:
- Confirm the `target` flag flows correctly: setting it to `'hair'` produces a result where the beard is unchanged from the reference photo.
- Test with both a face-only reference photo and a full-body one — face-only should be preferred.

## Mode 3 — Blend (v1.2)
*(Skip until v1.2.)* Same structure, plus:
- Confirm 2, 3, and 4 source images all work.
- Confirm labels propagate correctly into the prompt.
- Confirm user's optional extra prompt is appended verbatim.

## Privacy verification (must pass before any release)
- Search the entire codebase for the literal string `GEMINI_API_KEY`. It must appear only in `backend/wrangler.toml` config and `backend/src/`. Zero hits in `extension/`.
- Confirm reference photos never appear in any request URL, query string, or any storage other than `chrome.storage.local`.
- Confirm the privacy explainer in onboarding accurately describes what gets sent where.

## "Definition of done" for Mode 1 v1
All of the following are true:
- [ ] All automated checks pass
- [ ] Manual smoke test passes on Myntra, Amazon Fashion India, and Flipkart
- [ ] Right-click universal flow works on at least one unsupported site
- [ ] Privacy verification passes
- [ ] Median generation time ≤ 12s on a real connection
- [ ] README.md has install + usage instructions for a beta tester
- [ ] At least one teammate (or you) has run through the full onboarding without help

When Claude believes a task is done, it should print this checklist with each item marked, not a free-form summary.

## Mode 1 v2 — garment slots (D10)

### Automated
`backend/src/generate.test.ts` covers each prompt-selection combo (`pickPrompt`), garment ordering (`validateAndOrderGarments`), and rejects invalid combos (0, 3, two-tops, top+full). `extension/src/background/router.test.ts` covers `applyAdd` slot rules (full replaces all; non-full replaces existing full; same slot replaced; top+bottom kept together) and the multi-garment GENERATE → backend body shape.

### Manual smoke (run all 4 on Myntra)
1. **1 slot, "Full outfit"** on a model wearing both top + bottom → user image shows both replaced from the same source.
2. **1 slot, "Top only"** on a t-shirt or shirt product → user's existing pants/jeans are unchanged.
3. **1 slot, "Bottom only"** on a jeans / trousers product → user's existing top is unchanged.
4. **2 slots, top from product A + bottom from product B** → user wears the top from A and the bottom from B; nothing is mixed between sources.

For each case verify:
- Side panel garments strip shows the right thumbnail(s) and slot label(s).
- Generate is disabled until the slot combination is valid (1 garment, or 1 top + 1 bottom).
- Switching a slot to "Full outfit" while a 2nd garment exists collapses the list to that single garment.
- The Worker terminal logs a single `POST /generate` per click; payload contains `garments: [...]` ordered top-first when both present.

## Mode 1 v3 — accessories (D11)

### Automated
`backend/src/generate.test.ts` covers `buildPrompt` for all three accessory modes, rejects `custom` without an accessory image, and asserts that the accessory image is appended as the LAST image part. `extension/src/background/router.test.ts` covers the `SET_ACCESSORIES_MODE` / `SET_PENDING_ACCESSORY` flow including the auto-flip-to-custom and drop-on-mode-switch behaviors.

### Manual smoke
1. **Off** — pick any garment, leave Accessories on `No accessories`, generate. Result preserves the user's existing accessories from the reference photo. Worker payload has `accessoriesMode: 'off'` and no accessory image.
2. **Model** — pick a garment whose model is wearing visible accessories (e.g., glasses, belt), set Accessories to `Use model's accessories`, generate. Result shows the user wearing those accessories. Payload has `accessoriesMode: 'model'`, still no accessory image.
3. **Custom — via right-click** — find an accessory image on any page (watch, glasses), right-click → `Use as accessory in TryOn`. Confirm the side panel auto-flips to `Pick a specific accessory` and shows a thumbnail. Generate. Payload has `accessoriesMode: 'custom'` and an `accessory` field; the result includes the chosen accessory.
4. **Custom — via upload** — switch to `Pick a specific accessory`, click the file input, pick a local image. Confirm thumbnail appears, Generate works.
5. **Validation** — switch to `Pick a specific accessory` with no accessory loaded → Generate button is disabled.

## Mode 2 v1 — Hairstyle Try-On (D12)

### Automated
`backend/src/generate.test.ts` covers the hair body parser (rejects missing `hair_source`, rejects `mode: 'blend'`), confirms `HAIR_PROMPT` is sent verbatim, and asserts the image order to Gemini is `[reference, hair_source]`. `extension/src/background/router.test.ts` covers `SET_PENDING_HAIR_SOURCE` round-trip and the hair-mode `GENERATE` payload (mode='hair', no garments/accessories fields).

### Manual smoke
1. **Onboarding** — under Settings, upload at least one reference photo with type `face`. (Full body works but worse.)
2. **Right-click flow** — on any page (Wikipedia, an article, image search), right-click a hairstyle image → `Use this hairstyle in TryOn`. The side panel opens directly on the **Hair** tab with the thumbnail loaded.
3. **Generate** — click `Try this hairstyle`. Result keeps the user's face/expression/clothes/background/beard intact; only the hair on the head is replaced.
4. **Upload flow** — switch to Hair tab, clear the previous source via ×, pick a local image with the file input. Confirm thumbnail appears and Generate works.
5. **Reference fallback** — delete face photos under Settings, ensure full-body photos are picked up by the Hair tab (with a yellow tip at the top suggesting a face photo). Generate still runs.
6. **Tab independence** — pick a garment on the Outfit tab, then switch to Hair, pick a hairstyle, switch back. Garment state remains intact.
7. **Worker logs** — terminal shows a single `POST /generate` with body `{ mode: 'hair', reference_photo, hair_source, ... }` — no `garments` / `accessoriesMode` fields.

## Mode 1 v4 — outfit + optional hairstyle (D13)

### Automated
`backend/src/generate.test.ts` covers `buildPrompt(base, mode, hasHairSource=true)` for all combos, asserts that the hair source is the LAST image in the request, and that the hair clause appears AFTER the accessory clause when both are present. `extension/src/background/router.test.ts` covers `SET_PENDING_OUTFIT_HAIR_SOURCE` round-trip, the new `outfitHairSource` field in `GET_TRYON_STATE`, and that outfit GENERATE forwards `hair_source` to the backend payload only when present.

### Manual smoke (run on Pinterest + Myntra together)
1. **Outfit + hair via right-click** — Open the side panel on Outfit. On a Myntra product page, right-click the product → `Try this on with TryOn`. Then open Pinterest, find a hairstyle, right-click → `Use this hairstyle in TryOn`. The Outfit tab's hairstyle card should now show the thumbnail (NOT the Hair tab). Generate. Result shows the user wearing the new outfit AND with the new hairstyle. Worker payload contains `garments: [...]` and `hair_source: { image, mime }` as the LAST image.
2. **Outfit + hair via upload** — In the Outfit tab's hairstyle card, use the file input to upload a local hairstyle image. Generate; same expectation.
3. **Hair tab still works** — Click the Hair tab, right-click another hairstyle. It lands in the Hair tab's source, NOT the Outfit tab's. Generate from the Hair tab. Worker payload is `mode: 'hair'`, no `garments` / `accessoriesMode`.
4. **Tab independence** — set up an outfit + outfit hair source on the Outfit tab. Switch to Hair, set a different hair source. Switch back to Outfit. The Outfit hair source is still the original; the two states don't bleed into each other.
5. **Switch-to-Hair link** — when the Outfit hair source is set, the card shows a "Switch to the Hair tab" link. Clicking it navigates to `/hair` and the Outfit hair source remains intact for when the user comes back.
6. **Worker terminal** — on a combined try-on, log shows a single `POST /generate` whose `images` array has the order `[reference, garment(s), accessor(ies)?, hair_source]`. The `prompt` text contains both the relevant accessory clause (if used) and the `HAIR_IN_OUTFIT_CLAUSE` body.
