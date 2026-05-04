import {
  MemoryRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom';
import { useEffect, useState } from 'react';
import { Onboarding } from './routes/onboarding';
import { Settings } from './routes/settings';
import { TryOn } from './routes/try-on';
import { Hair } from './routes/hair';
import { send } from './messaging';
import { AccountChip } from './components/AccountChip';
import { Paywall } from './components/Paywall';
import { BottomTab } from './components/ui/Tab';
import { ToastProvider } from './components/ui/Toast';
import { EmptyState } from './components/ui/EmptyState';

export function App(): JSX.Element {
  const [hasPhoto, setHasPhoto] = useState<boolean | null>(null);
  const [initialPath, setInitialPath] = useState<string | null>(null);

  useEffect(() => {
    void (async (): Promise<void> => {
      const r = await send({ type: 'LIST_PHOTOS' });
      const has = r.ok && 'photos' in r && r.photos.length > 0;
      setHasPhoto(has);

      const last = await chrome.storage.session.get('last_action');
      const action = typeof last.last_action === 'string' ? last.last_action : null;
      if (action) {
        await chrome.storage.session.remove('last_action');
      }
      setInitialPath(!has ? '/onboarding' : action === 'hair' ? '/hair' : '/');
    })();
  }, []);

  if (hasPhoto === null || initialPath === null) {
    return (
      <main className="px-5">
        <EmptyState eyebrow="Loading" title="One moment." />
      </main>
    );
  }

  return (
    <ToastProvider>
      <MemoryRouter initialEntries={[initialPath]}>
        <ActiveTabPublisher />
        <PhotoStateSync onChange={setHasPhoto} />
        <Shell>
          <Routes>
            <Route path="/" element={<TryOn />} />
            <Route path="/hair" element={<Hair />} />
            <Route path="/onboarding" element={<Onboarding onDone={(): void => setHasPhoto(true)} />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/paywall" element={<PaywallRoute />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Shell>
      </MemoryRouter>
    </ToastProvider>
  );
}

function PaywallRoute(): JSX.Element {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  useEffect(() => {
    void (async (): Promise<void> => {
      const r = await send({ type: 'GET_ACCOUNT_STATE' });
      if (r.ok && 'account' in r) setSignedIn(r.account.signedIn);
      else setSignedIn(false);
    })();
  }, []);
  if (signedIn === null) {
    return (
      <main className="px-5">
        <EmptyState eyebrow="Loading" title="One moment." />
      </main>
    );
  }
  return <Paywall signedIn={signedIn} />;
}

function PhotoStateSync({ onChange }: { onChange: (has: boolean) => void }): null {
  const navigate = useNavigate();
  const location = useLocation();
  useEffect(() => {
    const listener = (
      changes: { [k: string]: chrome.storage.StorageChange },
      area: chrome.storage.AreaName,
    ): void => {
      if (area !== 'local' || !('reference_photos' in changes)) return;
      const next = changes.reference_photos?.newValue as unknown;
      const has = Array.isArray(next) && next.length > 0;
      onChange(has);
      if (!has && location.pathname !== '/onboarding') {
        navigate('/onboarding', { replace: true });
      } else if (has && location.pathname === '/onboarding') {
        navigate('/', { replace: true });
      }
    };
    chrome.storage.onChanged.addListener(listener);
    return (): void => chrome.storage.onChanged.removeListener(listener);
  }, [navigate, location.pathname, onChange]);
  return null;
}

function ActiveTabPublisher(): null {
  const location = useLocation();
  useEffect(() => {
    const tab: 'outfit' | 'hair' | 'other' =
      location.pathname === '/' ? 'outfit'
      : location.pathname === '/hair' ? 'hair'
      : 'other';
    void send({ type: 'SET_ACTIVE_TAB', tab });
  }, [location.pathname]);
  return null;
}

// ---------- Inline icon SVGs ----------

function OutfitIcon({ className = 'h-5 w-5' }: { className?: string }): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M16 4l-2 2-2 1-2-1-2-2-3.5 2 1.5 4 2-1v12h8V9l2 1 1.5-4L16 4z" />
    </svg>
  );
}

function HairIcon({ className = 'h-5 w-5' }: { className?: string }): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M5 13c0-5 3-9 7-9s7 4 7 9" />
      <path d="M5 13c-1 3 0 6 2 8" />
      <path d="M19 13c1 3 0 6-2 8" />
      <circle cx="12" cy="14" r="4" />
    </svg>
  );
}

function SettingsIcon({ className = 'h-5 w-5' }: { className?: string }): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.36.15.66.41.87.71" />
    </svg>
  );
}

// ---------- Shell ----------

function Shell({ children }: { children: React.ReactNode }): JSX.Element {
  const location = useLocation();
  const path = location.pathname;
  const showTabs = path === '/' || path === '/hair' || path === '/settings';
  return (
    <div className="flex h-screen flex-col bg-paper">
      <header className="flex items-center justify-between border-b border-rule bg-paper px-5 py-3.5 shrink-0">
        <h1 className="font-display text-[22px] italic font-bold text-accent select-none leading-none">
          TRY<span className="text-ink not-italic">·</span>ON
        </h1>
        <AccountChip />
      </header>
      <div className="flex-1 overflow-y-auto" style={{ paddingBottom: showTabs ? '76px' : '0' }}>
        {children}
      </div>
      {showTabs && (
        <nav
          className="fixed inset-x-0 bottom-0 bg-paper border-t border-rule flex items-stretch z-40"
          style={{ paddingBottom: 'env(safe-area-inset-bottom, 0)' }}
        >
          <BottomTab to="/" active={path === '/'} label="Outfit" icon={<OutfitIcon />} />
          <BottomTab to="/hair" active={path === '/hair'} label="Hair" icon={<HairIcon />} />
          <BottomTab to="/settings" active={path === '/settings'} label="Settings" icon={<SettingsIcon />} />
        </nav>
      )}
    </div>
  );
}
