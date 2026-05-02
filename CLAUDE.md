# TryOn — Claude Code Context

Chrome extension (Manifest V3) that lets shoppers see clothes / hair / beard on themselves while browsing, powered by Google's Nano Banana 2 image model.

## Read these first
- @SPEC.md — what we're building and why
- @docs/architecture.md — tech stack, file layout, MV3 patterns
- @docs/prompts.md — exact Gemini prompt templates (do not invent your own)
- @docs/site-adapters.md — DOM selectors for Myntra, Amazon, Flipkart
- @docs/verification.md — how to confirm work is correct
- @docs/decisions.md — locked-in decisions, do not relitigate

## Tech stack
- **Extension:** Manifest V3, TypeScript (strict), React 18, Vite, Tailwind, `@crxjs/vite-plugin`
- **Backend proxy:** Cloudflare Worker, TypeScript, holds the Gemini API key
- **AI model:** `gemini-3.1-flash-image-preview` (Nano Banana 2) at 1K resolution
- **Storage:** `chrome.storage.local` only — user photos never leave the device except as inline image data in a single Gemini request

## Project layout
```
tryon/
├── extension/           # Chrome extension (MV3)
│   ├── src/
│   │   ├── sidepanel/   # React UI (main user surface)
│   │   ├── background/  # Service worker (API calls, message routing)
│   │   ├── content/     # Page-injected scripts (image detection, hover button)
│   │   ├── adapters/    # Per-site product image extractors
│   │   ├── lib/         # Shared utilities (storage, image helpers, types)
│   │   └── popup/       # Tiny popup → opens side panel
│   ├── manifest.json
│   └── vite.config.ts
└── backend/             # Cloudflare Worker
    ├── src/
    │   ├── index.ts     # Router
    │   ├── generate.ts  # Nano Banana 2 proxy
    │   └── ratelimit.ts # Per-device-id daily limit
    └── wrangler.toml
```

## Commands
```bash
# Extension
cd extension
pnpm install
pnpm dev              # Vite dev build, watch mode → load `dist/` in chrome://extensions
pnpm build            # Production build
pnpm lint             # ESLint
pnpm typecheck        # tsc --noEmit
pnpm test             # Vitest (unit tests for adapters and lib)

# Backend
cd backend
pnpm install
pnpm dev              # wrangler dev (local Worker)
pnpm deploy           # wrangler deploy
pnpm test             # Vitest
```

## Code style
- TypeScript strict, no `any`, no non-null assertions (`!`) without a comment explaining why
- Named exports only, no default exports
- React: function components + hooks, no class components
- Tailwind utility classes only, no custom CSS files
- Async/await over `.then()` chains
- One file per component, kebab-case filenames, PascalCase component names
- Site adapters live in `extension/src/adapters/<site>.ts` and export a `SiteAdapter` (see `docs/site-adapters.md` for the interface)

## Critical rules (do not violate)
- **Never** put the Gemini API key in the extension. It lives only in the Worker as a secret.
- **Never** upload the user's reference photo to any storage we control. It goes from `chrome.storage.local` → inline in the Gemini request → discarded.
- **Never** scrape product pages beyond what's needed for the current try-on. No background crawling.
- **Never** call the Gemini API without going through the Worker proxy.
- **Always** use the prompt templates in `docs/prompts.md` verbatim. If a template needs to change, update the doc first, then the code.
- **Always** show a clear cost/usage indicator in the UI when a generation runs.
- **Always** include `usePlaceholderImages: true` mode for local dev so contributors don't burn API credits.

## MV3 gotchas Claude tends to forget
- The service worker goes to sleep. Do not store state in module-scope variables; use `chrome.storage.session` for ephemeral state.
- `chrome.sidePanel.open()` must be called from a user gesture handler (e.g., `chrome.action.onClicked` listener), not arbitrarily.
- Content scripts cannot use most `chrome.*` APIs. Route everything through the service worker via `chrome.runtime.sendMessage`.
- Cross-origin image fetches in content scripts need the target origin in `host_permissions`.

## When in doubt
- For new features → re-read SPEC.md and confirm it's in scope for v1
- For technical choices → check decisions.md before proposing alternatives
- For "is this done?" → run the checklist in verification.md, don't just claim victory
