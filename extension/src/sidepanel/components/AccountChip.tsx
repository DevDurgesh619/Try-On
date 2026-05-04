import { useEffect, useRef, useState } from 'react';
import { send } from '../messaging';
import type { AccountState } from '@/lib/types';
import { useToast } from './ui/Toast';

export function AccountChip(): JSX.Element {
  const [account, setAccount] = useState<AccountState | null>(null);
  const [loading, setLoading] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const previouslySignedIn = useRef<boolean | null>(null);
  const toast = useToast();
  const wrapRef = useRef<HTMLDivElement>(null);

  async function refresh(force = false): Promise<void> {
    const r = await send({ type: 'GET_ACCOUNT_STATE', refresh: force });
    if (r.ok && 'account' in r) setAccount(r.account);
  }

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    const listener = (
      changes: { [k: string]: chrome.storage.StorageChange },
      area: chrome.storage.AreaName,
    ): void => {
      if (area !== 'local') return;
      if ('tryon_auth' in changes) void refresh();
    };
    chrome.storage.onChanged.addListener(listener);
    return (): void => chrome.storage.onChanged.removeListener(listener);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const onDocClick = (e: MouseEvent): void => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return (): void => document.removeEventListener('mousedown', onDocClick);
  }, [menuOpen]);

  useEffect(() => {
    if (account === null) return;
    const prev = previouslySignedIn.current;
    if (prev === false && account.signedIn) {
      toast.show('Welcome. Five more on us.', 'signal');
    }
    previouslySignedIn.current = account.signedIn;
  }, [account, toast]);

  async function onSignIn(): Promise<void> {
    setLoading(true);
    try {
      const r = await send({ type: 'SIGN_IN' });
      if (r.ok && 'account' in r) setAccount(r.account);
    } finally {
      setLoading(false);
    }
  }

  async function onSignOut(): Promise<void> {
    setMenuOpen(false);
    await send({ type: 'SIGN_OUT' });
    setAccount({ signedIn: false });
  }

  if (!account) {
    return <span className="font-mono text-meta tracking-meta text-mute-soft">· · ·</span>;
  }

  if (!account.signedIn) {
    return (
      <button
        type="button"
        onClick={(): void => void onSignIn()}
        disabled={loading}
        className="bg-cta-gradient text-bone font-sans text-[11px] font-semibold tracking-cta rounded-pill px-4 py-2 shadow-cta hover:shadow-cta-lg hover:scale-[1.02] active:scale-[0.99] transition-all duration-200 ease-editorial disabled:opacity-60"
        title="Get 5 more free try-ons"
      >
        {loading ? <span className="font-mono tracking-meta">· · ·</span> : 'Sign in · +5 free'}
      </button>
    );
  }

  const credits =
    typeof account.credits_remaining === 'number' ? account.credits_remaining : null;
  const initial = (account.email ?? 'U').slice(0, 1).toUpperCase();

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        onClick={(): void => setMenuOpen((v) => !v)}
        className="flex items-center gap-2 transition-opacity duration-200 hover:opacity-85"
      >
        {credits !== null && (
          <span className="font-mono text-meta uppercase tracking-meta font-semibold text-accent bg-accent-tint rounded-pill px-2.5 py-1 animate-fade-rise">
            {String(credits).padStart(2, '0')} LEFT
          </span>
        )}
        <span className="flex h-8 w-8 items-center justify-center rounded-pill bg-accent-tint text-accent font-sans text-[13px] font-bold border border-accent-ring">
          {initial}
        </span>
      </button>
      {menuOpen && (
        <div className="absolute right-0 z-30 mt-2 w-52 bg-bone rounded-card border border-rule shadow-card-lg animate-fade-rise overflow-hidden">
          <div className="px-4 py-3 border-b border-rule">
            <p className="font-sans text-caption text-mute truncate">{account.email ?? 'Signed in'}</p>
          </div>
          <button
            type="button"
            onClick={(): void => void onSignOut()}
            className="block w-full px-4 py-3 text-left font-sans text-caption text-ink hover:bg-paper-subtle transition-colors duration-200"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
