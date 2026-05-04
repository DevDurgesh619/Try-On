#!/bin/bash
cd ~/Desktop/tryon/extension
echo "=== typecheck ==="
pnpm typecheck 2>&1
echo "=== lint ==="
pnpm lint 2>&1
echo "=== test ==="
pnpm test 2>&1
echo "=== build ==="
pnpm build 2>&1
echo "=== DONE ==="
