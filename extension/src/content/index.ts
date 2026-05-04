import type { SourceImageSelectedMsg } from '@/lib/types';

// One-line console signal so the user can confirm in DevTools that the
// content script actually loaded on this page (e.g. on Pinterest).
console.info('[tryon] content script loaded on', location.host);

// Hover-button is universal across every site listed in
// content_scripts.matches. The site adapter (if any) only matters for the
// auto-detect feature — which has been removed. So all we need to do is
// install the hover button.
installHoverButton();

// Minimum render-size for an image to be considered "tryon-able". Lowered
// from the original 200px because Pinterest grid pins can be ~150–200px in
// the feed, and they're a primary source for hairstyle references.
const MIN_IMAGE_PX = 140;

let hoverEl: HTMLElement | null = null;
let activeImg: HTMLImageElement | null = null;
let dwellTimer: number | null = null;

// 110ms dwell delay before chip appears — prevents flicker on mouse cross.
const DWELL_DELAY_MS = 110;

function installHoverButton(): void {
  let scheduled = false;
  let lastX = 0;
  let lastY = 0;
  const onMove = (ev: MouseEvent): void => {
    lastX = ev.clientX;
    lastY = ev.clientY;
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      const img = findImageAtPoint(lastX, lastY);
      if (!img) {
        if (activeImg || dwellTimer !== null) hideButton();
        return;
      }
      if (!isLikelyProductImage(img)) return;
      if (img !== activeImg) {
        scheduleShow(img);
      }
    });
  };
  document.addEventListener('mousemove', onMove, { passive: true, capture: true });
  document.addEventListener(
    'scroll',
    () => hideButton(),
    { passive: true, capture: true },
  );
}

function scheduleShow(img: HTMLImageElement): void {
  if (dwellTimer !== null) {
    clearTimeout(dwellTimer);
    dwellTimer = null;
  }
  activeImg = img;
  dwellTimer = window.setTimeout(() => {
    dwellTimer = null;
    if (activeImg === img) showButtonNear(img);
  }, DWELL_DELAY_MS);
}

/**
 * Find the topmost <img> element under the cursor, honouring overlay layers.
 * elementsFromPoint sees through pointer-events:none and z-index stacking, so
 * Pinterest's click-overlay divs no longer mask the underlying pin image.
 */
function findImageAtPoint(x: number, y: number): HTMLImageElement | null {
  const els = document.elementsFromPoint(x, y);
  for (const el of els) {
    if (el instanceof HTMLImageElement) return el;
    // Pinterest sometimes nests the <img> one level deep inside an overlay
    // wrapper. If the topmost element directly contains an <img> child whose
    // bounds enclose the cursor, prefer that one.
    if (el instanceof HTMLElement && !el.hasAttribute('data-tryon')) {
      const inner = el.querySelector('img');
      if (inner) {
        const r = inner.getBoundingClientRect();
        if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
          return inner;
        }
      }
    }
  }
  return null;
}

function isLikelyProductImage(img: HTMLImageElement): boolean {
  const rect = img.getBoundingClientRect();
  const url = img.currentSrc || img.src;
  if (!url) return false;
  return rect.width >= MIN_IMAGE_PX && rect.height >= MIN_IMAGE_PX;
}

/**
 * Pick the best URL we can find for an <img>:
 *
 *  - On Pinterest the visible <img>.src is a tiny 236px thumbnail. The same
 *    image's `srcset` lists 1x/2x/3x/4x variants and an `/originals/` URL
 *    that points to the unscaled upload. We prefer `/originals/` if present,
 *    then the highest-density entry, then currentSrc, then src.
 *  - On other sites this collapses to currentSrc / src.
 */
function pickBestImageUrl(img: HTMLImageElement | null): string | null {
  if (!img) return null;
  const set = img.getAttribute('srcset');
  if (set) {
    const entries = set
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .map((entry) => {
        // Each entry looks like "https://… 2x" or "https://… 736w".
        const lastSpace = entry.lastIndexOf(' ');
        const url = (lastSpace > 0 ? entry.slice(0, lastSpace) : entry).trim();
        const desc = (lastSpace > 0 ? entry.slice(lastSpace + 1) : '').trim();
        const density = desc.endsWith('x')
          ? parseFloat(desc.slice(0, -1))
          : desc.endsWith('w')
            ? parseFloat(desc.slice(0, -1)) / 100
            : 1;
        return { url, density: Number.isFinite(density) ? density : 1 };
      });
    const originals = entries.find((e) => /\/originals\//.test(e.url));
    if (originals) return originals.url;
    if (entries.length > 0) {
      const best = entries.reduce((a, b) => (b.density > a.density ? b : a));
      return best.url;
    }
  }
  return img.currentSrc || img.src || null;
}

function showButtonNear(img: HTMLImageElement): void {
  if (!hoverEl) hoverEl = createButton();
  const rect = img.getBoundingClientRect();
  hoverEl.style.top = `${rect.top + 8}px`;
  hoverEl.style.left = `${rect.left + 8}px`;
  hoverEl.style.display = 'block';
  hoverEl.style.opacity = '0';
  // Force reflow so the transition kicks in.
  void hoverEl.offsetHeight;
  hoverEl.style.opacity = '1';
}

function hideButton(): void {
  if (dwellTimer !== null) {
    clearTimeout(dwellTimer);
    dwellTimer = null;
  }
  if (hoverEl) {
    hoverEl.style.display = 'none';
    hoverEl.style.opacity = '0';
  }
  activeImg = null;
}

function createButton(): HTMLElement {
  const b = document.createElement('button');
  b.textContent = 'TRY ON';
  b.setAttribute('data-tryon', '1');
  b.style.cssText = [
    'position:fixed',
    'z-index:2147483647',
    'padding:7px 14px',
    'height:28px',
    'border-radius:9999px',
    'background:linear-gradient(135deg,#7C3AED 0%,#A855F7 100%)',
    'color:#FFFFFF',
    "font:700 11px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif",
    'letter-spacing:1.4px',
    'text-transform:uppercase',
    'border:none',
    'cursor:pointer',
    'box-shadow:0 4px 14px rgba(124,58,237,.35),inset 0 1px 0 rgba(255,255,255,.2)',
    'pointer-events:auto',
    'margin:0',
    'opacity:0',
    'transition:opacity 140ms ease-out',
    'display:none',
  ].join(';');
  b.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const url = pickBestImageUrl(activeImg);
    if (!url) return;
    const msg: SourceImageSelectedMsg = {
      type: 'SOURCE_IMAGE_SELECTED',
      url,
      origin: 'hover',
    };
    void chrome.runtime.sendMessage(msg);
  });
  // Prefer document.body — it always exists by document_idle and won't be
  // wiped by frameworks that re-render the documentElement's children.
  (document.body || document.documentElement).appendChild(b);
  return b;
}
