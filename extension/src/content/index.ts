import { findAdapter } from '@/adapters';
import type { SourceImageSelectedMsg } from '@/lib/types';

const adapter = findAdapter(location.hostname);
if (adapter) {
  initContentScript();
}

function initContentScript(): void {
  // Hover-button install. Auto-detect-on-load was removed: content scripts can't
  // write to chrome.storage.session, and we never used the value anyway.
  installHoverButton();
}

let hoverEl: HTMLElement | null = null;
let activeImg: HTMLImageElement | null = null;

function installHoverButton(): void {
  document.addEventListener(
    'mouseover',
    (ev) => {
      const target = ev.target;
      if (!(target instanceof HTMLImageElement)) return;
      if (!isLikelyProductImage(target)) return;
      activeImg = target;
      showButtonNear(target);
    },
    true,
  );
  document.addEventListener(
    'scroll',
    () => hideButton(),
    { passive: true, capture: true },
  );
}

function isLikelyProductImage(img: HTMLImageElement): boolean {
  const rect = img.getBoundingClientRect();
  return rect.width >= 200 && rect.height >= 200 && img.src.length > 0;
}

function showButtonNear(img: HTMLImageElement): void {
  if (!hoverEl) hoverEl = createButton();
  const rect = img.getBoundingClientRect();
  hoverEl.style.top = `${window.scrollY + rect.top + 8}px`;
  hoverEl.style.left = `${window.scrollX + rect.left + 8}px`;
  hoverEl.style.display = 'block';
}

function hideButton(): void {
  if (hoverEl) hoverEl.style.display = 'none';
}

function createButton(): HTMLElement {
  const b = document.createElement('button');
  b.textContent = 'Try on';
  b.setAttribute('data-tryon', '1');
  b.style.cssText = [
    'position:absolute',
    'z-index:2147483647',
    'padding:6px 10px',
    'border-radius:9999px',
    'background:#111',
    'color:#fff',
    'font:600 12px/1 system-ui,sans-serif',
    'border:none',
    'cursor:pointer',
    'box-shadow:0 2px 8px rgba(0,0,0,.25)',
    'display:none',
  ].join(';');
  b.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const url = activeImg?.currentSrc || activeImg?.src;
    if (!url) return;
    const msg: SourceImageSelectedMsg = {
      type: 'SOURCE_IMAGE_SELECTED',
      url,
      origin: 'hover',
    };
    void chrome.runtime.sendMessage(msg);
  });
  document.documentElement.appendChild(b);
  return b;
}
