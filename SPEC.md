# TryOn — Product Spec

## Problem
When shopping online for clothes, users only see the item on a model. To see how it would look on themselves, they currently have to:
1. Screenshot the item
2. Open Google's Gemini / Nano Banana
3. Upload their own photo
4. Upload the screenshot
5. Write a prompt
6. Wait for the result

Most people won't do this. The "try it on me" intent is lost. The same friction exists for hairstyles and beards on grooming/celebrity content.

## Solution
A Chrome extension that does the entire try-on flow in **one click** while the user is already on the shopping page. The user uploads a small library of reference photos once. From then on, any product image on any supported site can be tried on instantly.

## Goals
- Reduce a 6-step flow to a 1-click flow.
- Work on Myntra, Amazon Fashion (India), and Flipkart with tuned product detection.
- Work on every other site as a universal fallback (right-click any image → "Try on").
- Keep the user's reference photos on-device. They are sensitive.
- Generation under 15 seconds end-to-end on a normal connection.

## Non-goals (v1)
- A standalone web app or mobile app. Chrome extension only.
- Multi-user accounts, social sharing, or saved try-on history beyond local recents.
- Recommending products. We are not a shopping engine.
- Try-on for shoes, accessories, or full outfits combining many items (Mode 3 covers blends but is post-MVP).
- A try-on marketplace, affiliate links, or any monetization beyond the user-facing product itself.

## Target users
- **Primary:** Indian online fashion shoppers, ages 18–40, browsing on desktop Chrome.
- **Secondary:** Anyone considering a haircut or beard change who wants to preview the look.

## The three modes

### Mode 1 — Outfit Try-On (v1 MVP)
**Trigger:** User is on a product page on a supported site, or right-clicks any image anywhere.
**Flow:**
1. User clicks the TryOn extension icon → side panel opens.
2. Side panel shows the page's main product image (auto-detected via site adapter), or for unsupported sites prompts user to right-click an image.
3. User picks which reference photo to use (default = first one in their library).
4. User clicks **Try it on**.
5. Extension sends `[reference_photo, product_image, prompt_template_outfit]` to the backend.
6. Backend calls Nano Banana 2, returns the generated image.
7. Side panel displays result with **Download**, **Regenerate**, and **Try a different photo** buttons.

**Done when:** A user can browse a Myntra product page, open the panel, click one button, and get a try-on image of themselves wearing it within 15 seconds.

### Mode 2 — Hair & Beard Try-On (v1.1)
**Trigger:** Same as Mode 1, but the user toggles to "Hair & Beard" mode in the side panel.
**Source for the look:** Either an image on the current page (e.g., a celebrity haircut article) or an upload from the user's device.
**Reference photo used:** The face-only photo from the user's library.
**Prompt:** Different template (see `docs/prompts.md` → `HAIR_BEARD_PROMPT`).

### Mode 3 — Blend Mode (v1.2)
**Trigger:** User opens the Blend tab in the side panel.
**Flow:**
1. User adds 2–4 source elements (clothing items, hairstyles, beard, accessories) by either picking from current-page images, recent try-ons, or fresh uploads.
2. User taps each element to label what to take from it ("shirt", "hairstyle", "beard").
3. User picks a reference photo.
4. Optional: user edits the auto-generated prompt.
5. Generate.

## User journeys

### First-time setup (one-time, ~2 minutes)
1. Install extension from Chrome Web Store.
2. Onboarding screen in side panel: "Add your reference photos."
3. User uploads 1–4 photos: at minimum one full-body photo (for clothing) and one face photo (for hair). Recommended: a few angles/lighting variations.
4. Photos saved to `chrome.storage.local`. A privacy note is shown explicitly stating photos stay on device except during a generation request.
5. User is told they get N free generations per day during the beta (see `docs/decisions.md`).

### Quick try-on (the main loop)
1. User is browsing Myntra, finds a kurta they like.
2. Clicks TryOn icon in toolbar.
3. Side panel opens, shows the kurta auto-detected from the page.
4. User clicks **Try it on**. Skeleton loader appears.
5. Result image streams in within ~10 seconds.
6. User downloads the image to share with a friend, or hits **Regenerate** for a different angle.

### Right-click universal flow (unsupported site)
1. User on some random fashion site that doesn't have a tuned adapter.
2. Right-click on any product image → context menu has "Try this on with TryOn".
3. Side panel opens with that image pre-loaded.
4. Rest of the flow is identical.

## Success criteria
A v1 launch is successful if:
- 90% of try-ons on Myntra/Amazon/Flipkart product pages auto-detect the right image without user help.
- Median end-to-end generation time ≤ 12 seconds.
- 70% of users who install complete the onboarding (upload at least one photo).
- 50% of users who finish onboarding generate ≥ 3 try-ons in their first week.
- Cost per active user per week stays under what we're willing to absorb (target: ₹15/user/week).

## Constraints & honest limitations
- Image generation can mangle prints, fit, and complex patterns. The UI must frame this as a "vibe check," not a fitting room. Tagline candidate: *"How would this look on you? Get the gist in one click."*
- We absorb generation costs in the beta. We will need to add real billing or per-user limits before scaling beyond ~1000 users.
- Scraping product images is for personal/private use only. We do not republish, cache, or share scraped images.
- Extension is desktop-Chrome only for v1. Mobile and other browsers are out of scope.

## Open questions (to revisit before v1.1)
- Do we need server-side image moderation on results before showing them? (Probably yes for public launch.)
- Should we let users save a small history of their best try-ons locally? (Lean yes — `chrome.storage.local`, max 20 images.)
- How do we handle the case where Myntra's DOM changes and our adapter breaks? (Health-check ping from the Worker, plus a "report broken site" button in the panel.)
