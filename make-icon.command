#!/bin/bash
cd ~/Desktop/tryon/cws-assets
echo "=== Converting SVG to PNG ==="
# Use qlmanage (built-in macOS)
qlmanage -t -s 128 -o . icon-128.svg 2>/dev/null
# qlmanage outputs icon-128.svg.png, rename it
if [ -f "icon-128.svg.png" ]; then
  mv icon-128.svg.png icon-128.png
  echo "icon-128.png created via qlmanage"
else
  # fallback: rsvg-convert or python
  python3 -c "
import subprocess, os
# Use sips with a workaround via a temp html
print('Trying sips...')
" 2>&1
  # Try Automator/Safari rendering via sips on a known PNG
  echo "qlmanage did not produce output, trying rsvg..."
  which rsvg-convert && rsvg-convert -w 128 -h 128 icon-128.svg -o icon-128.png || echo "rsvg not found"
fi
ls -lh icon-128.png 2>/dev/null || echo "PNG not created — see manual step below"
