/** Resolve a possibly-relative URL against the document base. Returns null on failure. */
export function resolveUrl(raw: string | null | undefined, doc: Document): string | null {
  if (!raw) return null;
  try {
    return new URL(raw, doc.baseURI).toString();
  } catch {
    return null;
  }
}

/** Pull the first url(...) target out of a CSS background-image style. */
export function parseBackgroundImageUrl(style: string | null | undefined): string | null {
  if (!style) return null;
  const m = style.match(/url\(\s*(['"]?)([^'")]+)\1\s*\)/);
  return m?.[2] ?? null;
}

export function trimOrNull(s: string | null | undefined): string | null {
  if (!s) return null;
  const t = s.trim();
  return t.length > 0 ? t : null;
}

export function warnMissing(adapter: string, what: string): void {
  console.warn(`[tryon:${adapter}] missing selector: ${what}`);
}
