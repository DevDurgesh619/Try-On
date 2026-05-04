import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

type Tone = 'neutral' | 'signal';

interface ToastEntry {
  id: number;
  message: string;
  tone: Tone;
}

interface ToastApi {
  show: (message: string, tone?: Tone) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}

interface ToastProviderProps {
  children: ReactNode;
}

export function ToastProvider({ children }: ToastProviderProps): JSX.Element {
  const [items, setItems] = useState<ToastEntry[]>([]);
  const seq = useRef(0);

  const show = useCallback((message: string, tone: Tone = 'neutral') => {
    seq.current += 1;
    const id = seq.current;
    setItems((cur) => [...cur, { id, message, tone }]);
    setTimeout(() => {
      setItems((cur) => cur.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const api = useMemo<ToastApi>(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastPortal items={items} />
    </ToastContext.Provider>
  );
}

interface ToastPortalProps {
  items: ToastEntry[];
}

function ToastPortal({ items }: ToastPortalProps): JSX.Element | null {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return createPortal(
    <div
      className="fixed inset-x-0 z-50 pointer-events-none flex flex-col items-center gap-2 px-4"
      style={{ bottom: '88px' }}
    >
      {items.map((t) => (
        <div
          key={t.id}
          className="pointer-events-auto w-full max-w-[420px] bg-bone rounded-card border border-rule shadow-card-lg px-4 py-3 animate-fade-rise"
        >
          <div className="flex items-start gap-3">
            <span
              className={[
                'mt-1 inline-block h-2 w-2 rounded-pill shrink-0',
                t.tone === 'signal' ? 'bg-accent' : 'bg-mute',
              ].join(' ')}
              aria-hidden="true"
            />
            <span className="font-sans text-body text-ink">{t.message}</span>
          </div>
        </div>
      ))}
    </div>,
    document.body,
  );
}
