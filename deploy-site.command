#!/bin/bash
cd ~/Desktop/tryon
echo "=== Deploying site to Cloudflare Pages ==="
npx wrangler pages deploy site --project-name=tryon --commit-dirty=true
