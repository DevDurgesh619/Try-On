# Decisions Log

Locked-in choices and the reasoning. Claude should **not** propose alternatives to anything in this file unless explicitly asked. Add new entries with date and rationale.

---

## D1 — AI model: Nano Banana 2 (`gemini-3.1-flash-image-preview`)
**Date:** 2026-05-02
**Choice:** Use Google's Nano Banana 2 for all image generations.
**Why:**
- Native multi-image input is exactly the shape we need (reference photo + source image + prompt).
- Released Feb 2026, brings Pro-tier fidelity at ~$0.045–0.067 per 1K-resolution image — half the cost of Pro.
- Subject consistency is the headline feature, which is critical for keeping the user's identity intact.
- Original Nano Banana (`gemini-2.5-flash-image`) is cheaper at ~$0.039/image but the identity preservation is noticeably weaker. We pay the small premium.
**Revisit if:** Per-generation cost becomes a blocker, in which case fall back to Nano Banana 1 with a stronger prompt.

## D2 — Billing: we absorb the cost during beta
**Date:** 2026-05-02
**Choice:** No user-facing billing in v1. Free for all installs, with per-device daily limit (5 generations/day).
**Why:**
- Reduces friction during the period where we're learning whether people actually want this.
- BYO-API-key was considered and rejected — it's a 5-minute task for engineers and a 5-day task for normal humans.
- Limit lives in the Worker (Cloudflare KV), not the extension, so users can't bypass it by clearing storage.
**Revisit if:** Cost-per-active-user-per-week exceeds ₹15, or daily generation count exceeds ~3000 across all users.

## D3 — Image picking UX: hover button + right-click context menu
**Date:** 2026-05-02
**Choice:** On supported sites, hovering a product image shows a small "Try on" button. Globally, right-clicking any image adds "Try this on with TryOn" to the context menu.
**Why:**
- Hover button is discoverable and zero-click for the obvious case.
- Right-click is the universal escape hatch for unsupported sites and edge cases.
- Auto-detecting all images in a sidebar gallery (the rejected option) was visually noisy and felt slow.
**Revisit if:** Users in testing don't notice the hover button — fall back to making the side panel show detected images.

## D4 — Result surface: Chrome side panel
**Date:** 2026-05-02
**Choice:** Use `chrome.sidePanel` API for the main UI and result viewer.
**Why:**
- Stays open as the user keeps browsing — they can keep generating without losing context.
- Doesn't cover the page like a floating overlay would.
- Doesn't open a new tab and pull the user away from shopping.
- Floating overlay was rejected because it conflicts with site UI on dense pages like Myntra search.
**Revisit if:** Users on smaller laptops complain about the side panel cramping the page.

## D5 — Site coverage: tuned adapters for 3 sites + universal fallback
**Date:** 2026-05-02
**Choice:** Build tuned adapters for Myntra, Amazon Fashion India, Flipkart. All other sites get the right-click fallback only.
**Why:**
- These three cover the vast majority of online clothing shopping in India (the primary market).
- Tuned adapters give a "magical" first experience on the sites users actually use.
- Universal fallback means we don't lock anyone out of less popular sites.
**Revisit if:** Analytics show heavy use on a 4th site (e.g., Ajio, Nykaa Fashion).

## D6 — MVP scope: Mode 1 only
**Date:** 2026-05-02
**Choice:** Ship Mode 1 (outfit try-on) as v1. Mode 2 (hair/beard) is v1.1. Mode 3 (blend) is v1.2.
**Why:**
- Mode 1 is the highest-volume use case and the simplest UX.
- Validating Mode 1 tells us whether the AI quality clears the bar before we invest in more modes.
- Hair/beard requires a different reference photo (face vs. full-body) and slightly different UX — better to layer on once Mode 1 ships.
**Revisit if:** Beta feedback says Mode 1 alone feels thin and people are asking for hair preview.

## D7 — Reference photos: small library (not single)
**Date:** 2026-05-02
**Choice:** Users can store up to 4 reference photos with labels (e.g., "front - daylight," "side - indoor"). Default = first one.
**Why:**
- Different lighting / angles produce different result quality. Letting users pick the best match per item is a quality lever with low UX cost.
- Hard cap at 4 to keep `chrome.storage.local` usage well under quota.
- Single-photo was rejected because users would constantly re-upload to swap.
**Revisit if:** Telemetry shows >90% of users only ever use one photo — simplify back to single.

## D8 — Backend: Cloudflare Worker
**Date:** 2026-05-02
**Choice:** Single Cloudflare Worker as the API proxy.
**Why:**
- Free tier (100k req/day) covers us through any realistic beta.
- Edge-deployed → low added latency on top of the Gemini call itself.
- Wrangler tooling is excellent. Secrets management via `wrangler secret put` is clean.
- Vercel Edge Functions and Supabase Edge Functions were both viable; Cloudflare won on cost and simplicity for a single-endpoint use case.
**Revisit if:** We need stateful features (real auth, user history server-side) — at that point reach for Supabase.

## D9 — Tech stack: Vite + React + TypeScript + Tailwind, `@crxjs/vite-plugin`
**Date:** 2026-05-02
**Choice:** Standard modern web stack, with `@crxjs/vite-plugin` to handle MV3 bundling.
**Why:**
- React + Tailwind is the fastest path to a polished side panel UI.
- `@crxjs/vite-plugin` handles HMR for content scripts and the service worker, which is a nightmare to set up by hand.
- TypeScript strict catches the kind of message-passing typo bugs that plague extension development.
**Revisit if:** We start hitting MV3 quirks the plugin doesn't handle — at that point consider Plasmo.

## D10 — Outfit Mode v2 introduces explicit garment slots
**Date:** 2026-05-02
**Choice:** Mode 1 supports up to 2 garment slots per try-on, each labeled `top`, `bottom`, or `full`. Valid combinations: 1 garment of any slot, or 1 `top` + 1 `bottom`. The Worker selects the prompt template (`OUTFIT_FULL`, `OUTFIT_TOP`, `OUTFIT_BOTTOM`, or `OUTFIT_TOP_AND_BOTTOM`) from the slot combination and sends garments in canonical order (top before bottom).
**Why:**
- Beta users repeatedly asked for explicit control: "swap only the jeans, leave my top alone" and "use this top from model A with these jeans from model B."
- Pulls a constrained subset of Mode 3 (Blend) into Mode 1 — clothing only, max 2 slots, no hair/beard/accessories. Hair/beard remains v1.1 Mode 2.
- Slot-specific prompts are dramatically more reliable for "preserve other clothing" than the generic "replace only the relevant clothing" line, which the model often reinterpreted aggressively.
- Right-click menu and hover button stay single-action by defaulting to slot `full`; users re-label or add a 2nd slot from the side panel.
**Revisit if:** Demand emerges for shoes, jackets, or accessories — extend `GarmentSlot` rather than building a generic Blend UI.

## D11 — Outfit Mode v3 adds an accessories mode (off / model / custom)
**Date:** 2026-05-02
**Choice:** Mode 1 gains a per-try-on `accessoriesMode` flag with three values:
- `off` (default) — base outfit prompt unchanged; user's existing accessories preserved.
- `model` — appends `ACCESSORY_FROM_MODEL_CLAUSE`; transfers any accessories the source garment's model is wearing onto the user.
- `custom` — appends `ACCESSORY_FROM_IMAGE_CLAUSE` and sends an additional accessory image as the LAST image in the request.
**Why:**
- Beta users wanted to opt into the source model's vibe (watches, glasses) without the all-or-nothing of "Full outfit," and separately wanted to mix in a specific accessory from a different page.
- A single `accessoriesMode` enum keeps the existing 4 outfit prompt templates intact — Phase 0 of accessory work doesn't change clothing behavior at all.
- Right-click "Use as accessory in TryOn" mirrors the existing "Try this on with TryOn" right-click flow, so the user picks accessories from the live page just like clothing. File upload is also supported for cases where the page doesn't have a clean accessory image.
- Setting the accessory auto-flips `accessoriesMode` to `custom` so the side panel state stays internally consistent without the user having to toggle a separate switch.
**Revisit if:** Demand emerges for multiple custom accessories per try-on (e.g., watch *and* glasses) — promote `accessory` to an array. Or move accessory behavior into Mode 3 Blend.

## D12 — Mode 2 v1 ships hair-only (no beard)
**Date:** 2026-05-03
**Choice:** Implement Mode 2 with a single `HAIR_PROMPT` and `mode: 'hair'` plumbed end-to-end. Beard / mustache / `target` flag deferred — the `HAIR_BEARD_PROMPT` definition stays in `docs/prompts.md` as a future reference only; backend rejects any mode other than `'outfit'` or `'hair'` in v1.
**Why:**
- Smaller surface = a stronger identity-preservation prompt. The hair prompt explicitly forbids modifying the beard/facial hair, which means a separate beard prompt can plug in later without changing today's behavior.
- Side panel becomes a tabbed UI (Outfit / Hair) so each pipeline keeps its own state in `chrome.storage.session` (`pending_hair_source` is independent of `pending_garments` / `pending_accessories`). A user in mid-flow on one tab doesn't lose state when they peek at the other.
- Right-click "Use this hairstyle in TryOn" mirrors the existing garment / accessory entries — a third image-context menu item, not a submenu (kept flat for now). When invoked, the SW writes `last_action: 'hair'` to session storage and the side panel reads it on mount to deep-link to `/hair`.
- Hover button stays clothing-only. There's no obvious "hover one image to try as hair" mental model on shopping sites; right-click + upload are the deliberate paths.
**Revisit if:** Demand emerges for beard support — add `BEARD_PROMPT` and surface a "Hair / Beard / Both" toggle in the Hair tab; the `mode` enum already supports `'hair'`, room for `'beard'` and `'both'` is already in `target`-style design.

---

## Open decisions (not yet locked)
- **Brand name** — "TryOn" is a placeholder. Pick before public launch.
- **Public privacy policy hosting** — needs a URL before submitting to Chrome Web Store.
- **Telemetry** — do we add minimal anonymized analytics (event counts, no images, no PII)? Tentatively yes for the beta, via a `/event` Worker endpoint, but not built yet.
