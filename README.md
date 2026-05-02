# TryOn

A Chrome extension that lets shoppers see clothes on themselves while browsing fashion sites — one click instead of a 6-step screenshot-and-prompt workaround. Powered by Google's Nano Banana 2 image model behind a Cloudflare Worker proxy.

v1 MVP scope = **Mode 1 (Outfit Try-On) only.** Hair/beard (v1.1) and Blend (v1.2) are deferred — see `docs/decisions.md` D6.

## Folder layout

```
tryon/
├── extension/   # Chrome extension (MV3, Vite + React + TypeScript + Tailwind)
├── backend/     # Cloudflare Worker (Wrangler + TypeScript)
├── SPEC.md
├── CLAUDE.md
└── docs/        # architecture, prompts, site adapters, verification, decisions
```

## Beta tester quick start

### 1. Build the extension
```bash
cd extension
pnpm install
pnpm build
```

### 2. Load it in Chrome
1. `chrome://extensions`
2. Enable **Developer mode** (top right)
3. **Load unpacked** → pick `extension/dist`

### 3. First-time setup
1. Click the TryOn toolbar icon → side panel opens to **Onboarding**.
2. Upload one full-body photo. Photos are compressed to ≤1024px and stored only in your browser's local storage.

### 4. Try something on
- **Supported sites (Myntra / Amazon Fashion India / Flipkart):** open a product page, hover over the main image, click the floating **Try on** pill — or just open the side panel; the page's primary image is auto-detected.
- **Anywhere else:** right-click any image → **Try this on with TryOn** → side panel opens with that image preloaded.

Then pick a reference photo and click **Try it on**. Result appears in 8–12s with **Download** / **Regenerate** / **Try a different photo** buttons.

> By default the extension runs in **placeholder mode** — it returns a 1×1 PNG instead of calling the live model. Toggle off in **Settings → Generation** when you're ready to spend Gemini credits.

## Development

```bash
# extension (terminal 1)
cd extension
pnpm dev                      # vite watch build → reload from chrome://extensions

# backend (terminal 2)
cd backend
pnpm dev                      # wrangler dev → http://localhost:8787
```

The extension's dev build is wired to `http://localhost:8787` (`extension/src/lib/config.ts`). Production build points at `https://tryon.workers.dev`.

### One-time backend setup
```bash
cd backend
npx wrangler login
npx wrangler kv namespace create RATE_LIMIT     # paste id into wrangler.toml
npx wrangler secret put GEMINI_API_KEY          # get one at https://aistudio.google.com/apikey
```

The `GEMINI_API_KEY` is a Cloudflare secret — it never appears in the extension, the repo, or any log. Verify with `grep -r GEMINI_API_KEY extension/` (zero hits expected).

### Test + lint + typecheck
```bash
# extension
cd extension && pnpm typecheck && pnpm lint && pnpm test && pnpm build

# backend
cd backend && pnpm typecheck && pnpm lint && pnpm test
```

### Deploy
```bash
cd backend && pnpm deploy     # wrangler deploy → https://tryon.workers.dev
cd extension && pnpm build    # zip extension/dist for Chrome Web Store
```

## Privacy

- Reference photos live in `chrome.storage.local` and are sent only as inline data inside a single `/generate` request to the Worker. They are not persisted server-side.
- Daily limit: 5 generations per device during the beta (`docs/decisions.md` D2). Stored in Cloudflare KV — clearing browser storage doesn't reset it.

## Reading order for new contributors
1. `SPEC.md` — what we're building and why
2. `docs/architecture.md` — how it's wired
3. `docs/decisions.md` — locked-in choices (don't relitigate)
4. `docs/site-adapters.md` + `docs/prompts.md` — selectors and prompts (the brittle parts)
5. `docs/verification.md` — the gate before calling something done
