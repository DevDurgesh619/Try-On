# TryOn — public site

Static HTML deployed via Cloudflare Pages to **https://tryon-9z6.pages.dev**.

Three pages:
- `index.html` — landing
- `privacy.html` — privacy policy (linked from manifest + Chrome Web Store submission)
- `terms.html` — terms of service

## Deploy

```bash
# One-time: create the Pages project
wrangler pages project create tryon --production-branch main

# Deploy
wrangler pages deploy site/ --project-name tryon
```

Or, even simpler if you don't want CLI: drag-and-drop the contents of `site/`
into the Cloudflare dashboard's Pages "Create with Direct Upload" flow.

## What's intentionally missing

- No Tailwind, no React, no JS bundler. Three static HTML files. The site is
  for Chrome Web Store reviewers and curious shoppers, not a marketing
  experience. Adding tooling here would be over-engineering for the role
  this site plays.
- No analytics. The privacy policy says we collect zero browsing data on the
  marketing site. Don't break that promise by adding GA later without
  updating the policy.

## When you have a domain

If you buy `tryon.app` or similar later:

1. Add the domain to the Cloudflare Pages project.
2. Update `extension/manifest.json` and `backend/wrangler.toml` references.
3. Update privacy/terms `support@tryon-9z6.pages.dev` to a real email at the new
   domain.
