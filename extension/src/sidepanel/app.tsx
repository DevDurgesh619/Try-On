import { Link, MemoryRouter, Navigate, Route, Routes } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { Onboarding } from './routes/onboarding';
import { Settings } from './routes/settings';
import { TryOn } from './routes/try-on';
import { Hair } from './routes/hair';
import { send } from './messaging';

export function App(): JSX.Element {
  const [hasPhoto, setHasPhoto] = useState<boolean | null>(null);
  const [initialPath, setInitialPath] = useState<string | null>(null);

  useEffect(() => {
    void (async (): Promise<void> => {
      const r = await send({ type: 'LIST_PHOTOS' });
      const has = r.ok && 'photos' in r && r.photos.length > 0;
      setHasPhoto(has);

      // If the user opened the side panel via a hair-mode action (right-click
      // "Use this hairstyle"), route straight to /hair so they see the source
      // they just picked.
      const last = await chrome.storage.session.get('last_action');
      const action = typeof last.last_action === 'string' ? last.last_action : null;
      if (action) {
        await chrome.storage.session.remove('last_action');
      }
      setInitialPath(!has ? '/onboarding' : action === 'hair' ? '/hair' : '/');
    })();
  }, []);

  if (hasPhoto === null || initialPath === null) {
    return <main className="p-4 text-sm text-gray-500">Loading…</main>;
  }

  return (
    <MemoryRouter initialEntries={[initialPath]}>
      <Shell>
        <Routes>
          <Route path="/" element={<TryOn />} />
          <Route path="/hair" element={<Hair />} />
          <Route path="/onboarding" element={<Onboarding onDone={(): void => setHasPhoto(true)} />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Shell>
    </MemoryRouter>
  );
}

function Shell({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center justify-between border-b px-4 py-3">
        <h1 className="text-base font-semibold">TryOn</h1>
        <nav className="space-x-3 text-xs text-gray-500">
          <Link to="/" className="hover:text-gray-900">Outfit</Link>
          <Link to="/hair" className="hover:text-gray-900">Hair</Link>
          <Link to="/settings" className="hover:text-gray-900">Settings</Link>
        </nav>
      </header>
      <div className="flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}
