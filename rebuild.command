#!/bin/bash
cd ~/Desktop/tryon/extension
echo "=== rebuild with correct Worker URL ==="
pnpm build 2>&1
echo "=== DONE — reload extension in chrome://extensions ==="
