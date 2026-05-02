# Architecture

## System diagram (text)

```
┌─────────────────────────────────────────────────────────────────┐
│  Chrome Browser                                                 │
│                                                                 │
│  ┌──────────────┐    ┌─────────────────┐   ┌────────────────┐  │
│  │ Content      │    │  Side Panel     │   │  Service       │  │
│  │ Script       │◄──►│  (React UI)     │◄─►│  Worker        │  │
│  │ - detect img │    │ - reference lib │   │ - msg routing  │  │
│  │ - hover btn  │    │ - generate btn  │   │ - storage I/O  │  │
│  │ - right-click│    │ - result viewer │   │ - API calls    │  │
│  └──────────────┘    └─────────────────┘   └────────┬───────┘  │
│                                                     │          │
└─────────────────────────────────────────────────────┼──────────┘
                                                      │
                                                      │ HTTPS
                                                      ▼
                          ┌─────────────────────────────────────┐
                          │  Cloudflare Worker (backend proxy)  │
                          │  - holds GEMINI_API_KEY secret      │
                          │  - rate-limits per device_id        │
                          │  - calls gemini-3.1-flash-image-... │
                          │  - returns base64 PNG               │
                          └────────────────┬────────────────────┘
                                           │
                                           ▼
                              ┌──────────────────────────┐
                              │ Google Gemini API        │
                              │ Nano Banana 2            │
                              └──────────────────────────┘
```

## Component responsibilities

### Service worker (`extension/src/background/`)
- Single entry point for all `chrome.*` API calls.
- Owns the message bus: receives messages from content scripts, side panel, and popup; routes to handlers.
- Owns the network: every backend call originates here.
- Manages `chrome.storage.local` reads/writes for reference photos and settings.
- Registers the right-click context menu item ("Try this on with TryOn").
- Handles `chrome.action.onClicked` to open the side panel.
- **Sleeps when idle.** Do not store state in module variables. Use `chrome.storage.session` for short-lived state if needed.

### Side panel (`extension/src/sidepanel/`)
- The main UI. React + Tailwind.
- Three top-level routes:
  - `/` — main try-on view (mode selector, source image, reference photo picker, generate button, result viewer)
  - `/onboarding` — first-time photo upload
  - `/settings` — manage reference photos, view usage, privacy notes
- Communicates with service worker via `chrome.runtime.sendMessage` only.
- Never calls the backend or Gemini API directly.

### Content scripts (`extension/src/content/`)
- Injected into supported sites (declared in `manifest.json`).
- One generic script + per-site enhancements via the adapter pattern.
- Responsibilities:
  - Detect the primary product image on page load (uses the site adapter).
  - Show a small floating "Try on" button on hover over product images (supported sites only).
  - Capture the image URL or blob when the user picks something.
- Cannot access most `chrome.*` APIs. Sends messages to the service worker for anything privileged.

### Site adapters (`extension/src/adapters/`)
Each adapter implements:
```ts
export interface SiteAdapter {
  hostMatch: RegExp;                                 // e.g. /myntra\.com$/
  getPrimaryProductImage(doc: Document): string | null;  // image URL
  getAllProductImages(doc: Document): string[];      // for galleries
  getProductMeta(doc: Document): ProductMeta | null; // title, brand, type
}
```
See `docs/site-adapters.md` for the actual selectors.

### Backend Worker (`backend/src/`)
- A single Cloudflare Worker, deployed via Wrangler.
- Two routes:
  - `POST /generate` — body: `{ device_id, mode, reference_photo (base64), source_image (base64), prompt_overrides? }` → returns `{ image (base64), generation_id, ms_taken }`
  - `GET /health` — returns adapter health checks (last-known-good selectors per site)
- Rate limit: 5 generations per `device_id` per UTC day during beta. Stored in Cloudflare KV.
- Secrets: `GEMINI_API_KEY` set via `wrangler secret put`. Never logged, never returned.

## Data flow for a single try-on

1. User clicks **Try it on** in the side panel.
2. Side panel sends `{ type: 'GENERATE', mode: 'outfit', sourceImageUrl, referencePhotoId }` to service worker.
3. Service worker:
   a. Loads the chosen reference photo from `chrome.storage.local` → base64.
   b. Fetches the source image URL → base64. (Service worker has the right host permissions.)
   c. Reads `device_id` from `chrome.storage.local` (generated on first install, UUIDv4).
   d. POSTs to Worker `/generate`.
4. Worker validates rate limit, builds the multi-image Gemini request using the prompt template from `docs/prompts.md`, calls Gemini, returns the result image.
5. Service worker forwards the image back to the side panel.
6. Side panel renders it. User can download (creates a Blob URL) or regenerate (re-runs step 2 with a `seed` bump).

## Gemini API call shape

Use the `@google/genai` SDK from the Worker. Request structure:

```ts
const response = await ai.models.generateContent({
  model: 'gemini-3.1-flash-image-preview',
  contents: [
    { inlineData: { mimeType: 'image/jpeg', data: referencePhotoB64 } },
    { inlineData: { mimeType: 'image/jpeg', data: sourceImageB64 } },
    { text: OUTFIT_PROMPT }, // from docs/prompts.md
  ],
  config: { responseModalities: ['IMAGE'] },
});
// Image is in response.candidates[0].content.parts[].inlineData
```

Always iterate through `parts` looking for `inlineData` — the API may return text+image.

## Storage schema

`chrome.storage.local`:
```ts
{
  device_id: string;                     // UUIDv4, set on install
  reference_photos: {
    id: string;                          // UUIDv4
    label: string;                       // user-given, e.g. "front - daylight"
    type: 'full_body' | 'face';
    data_url: string;                    // base64 jpeg, max 1024px on long edge
    created_at: number;
  }[];
  recent_results: {                      // max 20, FIFO
    id: string;
    mode: 'outfit' | 'hair' | 'blend';
    thumbnail_data_url: string;
    full_data_url: string;
    created_at: number;
  }[];
  settings: {
    default_reference_photo_id?: string;
    use_placeholder_images: boolean;     // dev-only
  };
}
```

Hard limits: total `chrome.storage.local` quota is 10MB. We enforce: max 4 reference photos, max 20 recent results, all images compressed to ≤1024px long edge before storing.

## Error handling

| Failure | UX behavior |
|---|---|
| No reference photo set | Onboarding flow forces one before any generation |
| Source image fetch fails (CORS, 404) | "Couldn't load that image — try right-clicking it instead" |
| Rate limit hit | "You've used your N free try-ons today. Resets at midnight UTC." |
| Gemini timeout (>30s) | Show "Still working..." then fail at 60s with retry button |
| Gemini safety block | "Couldn't generate that one — try a different photo or item" |
| Backend 5xx | Auto-retry once with backoff, then surface error with "Try again" |

## Deployment

- **Extension:** Built with `pnpm build` in `extension/`, output goes to `extension/dist/`. Manually load unpacked during dev. For production, zip `dist/` and upload to Chrome Web Store.
- **Backend:** `pnpm deploy` in `backend/` uses Wrangler to deploy to Cloudflare. The Worker URL is hardcoded in `extension/src/lib/config.ts` — different URLs for dev (`tryon-dev.workers.dev`) and prod (`tryon.workers.dev`).
