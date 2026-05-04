#!/bin/bash
cd ~/Desktop/tryon/backend
echo "=== Registering workers.dev subdomain (if needed) ==="
npx wrangler workers subdomain create tryon-launch 2>&1 || npx wrangler subdomain create tryon-launch 2>&1 || echo "(subdomain step skipped)"
echo "=== Deploying tryon-dev Worker ==="
npx wrangler deploy 2>&1
echo "=== Health check ==="
URL=$(npx wrangler deployments list 2>&1 | grep -o 'https://[^ ]*workers\.dev' | head -1)
if [ -n "$URL" ]; then
  echo "Worker URL: $URL"
  curl -s "$URL/health"
fi
