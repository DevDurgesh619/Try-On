#!/bin/bash
cd ~/Desktop/tryon/backend
echo "=== Setting GEMINI_API_KEY on tryon-dev Worker ==="
printf '%s' "AIzaSyCMTAhNbK-aFhwxyDkrZAG6NfZAxinL_D4" | npx wrangler secret put GEMINI_API_KEY
echo "=== Done. Deleting this script ==="
rm -- "$0"
