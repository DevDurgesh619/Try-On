import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { send } from '../messaging';
import { compressImage } from '@/lib/image';
import type {
  PendingHairSource,
  ReferencePhoto,
  RecentResult,
} from '@/lib/types';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { EmptyState } from '../components/ui/EmptyState';
import { useToast } from '../components/ui/Toast';
import { humanizeError } from '../components/ui/errors';
import { ResultSkeleton, ResultViewer } from '../components/ResultViewer';

type Phase = 'idle' | 'loading' | 'done' | 'error';

export function Hair(): JSX.Element {
  const [photos, setPhotos] = useState<ReferencePhoto[]>([]);
  const [activePhotoId, setActivePhotoId] = useState<string | null>(null);
  const [hairSource, setHairSource] = useState<PendingHairSource | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [result, setResult] = useState<RecentResult | null>(null);
  const [msTaken, setMsTaken] = useState<number | null>(null);
  const sequenceRef = useRef(0);
  const navigate = useNavigate();
  const toast = useToast();

  async function refreshHair(): Promise<void> {
    const r = await send({ type: 'GET_HAIR_STATE' });
    if (r.ok && 'source' in r) setHairSource(r.source);
  }

  useEffect(() => {
    void (async (): Promise<void> => {
      const p = await send({ type: 'LIST_PHOTOS' });
      if (p.ok && 'photos' in p) {
        const sorted = [...p.photos].sort((a, b) => {
          if (a.type === b.type) return 0;
          return a.type === 'face' ? -1 : 1;
        });
        setPhotos(sorted);
        setActivePhotoId(sorted[0]?.id ?? null);
      }
      await refreshHair();
    })();
  }, []);

  useEffect(() => {
    const listener = (
      changes: { [k: string]: chrome.storage.StorageChange },
      area: chrome.storage.AreaName,
    ): void => {
      if (area === 'session' && 'pending_hair_source' in changes) {
        void refreshHair();
      }
    };
    chrome.storage.onChanged.addListener(listener);
    return (): void => chrome.storage.onChanged.removeListener(listener);
  }, []);

  async function uploadHair(file: File): Promise<void> {
    const dataUrl = await readAsDataUrl(file);
    const compressed = await compressImage(dataUrl, 1024, 0.85);
    await send({
      type: 'SET_PENDING_HAIR_SOURCE',
      source: { url: compressed.data_url, origin: 'upload' },
    });
    await refreshHair();
  }

  async function clearHair(): Promise<void> {
    await send({ type: 'CLEAR_PENDING_HAIR_SOURCE' });
    await refreshHair();
  }

  async function generate(): Promise<void> {
    if (!canGenerate || !activePhotoId || !hairSource) return;
    setPhase('loading');
    setErrorMsg(null);
    const r = await send({
      type: 'GENERATE',
      mode: 'hair',
      referencePhotoId: activePhotoId,
      hairSourceUrl: hairSource.url,
    });
    if (!r.ok) {
      if (r.code === 'out_of_credits' || r.code === 'daily_cap') {
        setPhase('idle');
        navigate('/paywall');
        return;
      }
      const human = humanizeError(r.code, r.message);
      toast.show(human, 'signal');
      setPhase('error');
      setErrorMsg(human);
      return;
    }
    if ('result' in r) {
      sequenceRef.current += 1;
      setResult(r.result);
      setMsTaken(r.ms_taken);
      setPhase('done');
    }
  }

  async function startOver(): Promise<void> {
    await clearHair();
    setResult(null);
    setMsTaken(null);
    setPhase('idle');
  }

  const hasReference = photos.length > 0 && !!activePhotoId;
  const hasFacePhoto = photos.some((p) => p.type === 'face');
  const canGenerate = hasReference && !!hairSource;
  const activePhoto = photos.find((p) => p.id === activePhotoId) ?? null;

  if (photos.length === 0) {
    return (
      <main className="px-5">
        <EmptyState
          eyebrow="Step 01"
          title="A face photo, please."
          body="Add at least one face photo under Settings — it gives the model a clean canvas for hairstyles."
          action={
            <Link to="/settings">
              <span className="inline-flex items-center gap-2 rounded-pill bg-accent-tint text-accent font-sans text-[11px] font-semibold tracking-cta px-4 py-2 hover:bg-accent hover:text-bone transition-colors duration-200 ease-editorial">
                Go to Settings →
              </span>
            </Link>
          }
        />
      </main>
    );
  }

  return (
    <main className="space-y-6 px-5 py-6">
      <header className="space-y-2">
        <Badge tone="signal">◆ Hair Studio</Badge>
        <h2 className="font-display text-display-lg font-semibold text-ink">
          A new cut, <span className="italic text-accent">on you.</span>
        </h2>
        {!hasFacePhoto && (
          <p className="font-sans text-caption text-mute mt-3 max-w-[440px]">
            Tip: results are sharper with a face reference photo. Add one in Settings.
          </p>
        )}
      </header>

      <Step n={1} title="Choose your face photo">
        <div className="flex gap-3 overflow-x-auto pb-1">
          {photos.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={(): void => setActivePhotoId(p.id)}
              className="shrink-0"
              title={`${p.label} · ${p.type}`}
            >
              <span
                className={[
                  'block rounded-card transition-all duration-200 ease-editorial',
                  activePhotoId === p.id
                    ? 'p-[3px] ring-2 ring-accent ring-offset-2 ring-offset-paper'
                    : 'p-[3px] hover:ring-1 hover:ring-rule',
                ].join(' ')}
              >
                <img src={p.data_url} alt={p.label} className="block h-16 w-16 object-cover rounded-sm" />
              </span>
              <span
                className={[
                  'mt-1.5 block text-center font-sans text-[10px] font-semibold tracking-cta',
                  activePhotoId === p.id ? 'text-accent' : 'text-mute',
                ].join(' ')}
              >
                {p.type === 'face' ? 'FACE' : 'FULL'}
              </span>
            </button>
          ))}
        </div>
        {activePhoto && (
          <p className="font-sans text-caption text-mute mt-2">
            Selected · {activePhoto.label}
            {activePhoto.type !== 'face' && ' · face works better'}
          </p>
        )}
      </Step>

      <Step n={2} title="Pick a hairstyle reference">
        {hairSource ? (
          <div className="flex items-center gap-3 rounded-card bg-bone border border-accent-ring p-2 shadow-card">
            <img src={hairSource.url} alt="hairstyle" className="h-20 w-20 object-cover rounded-sm" />
            <div className="flex-1 min-w-0">
              <span className="inline-flex items-center gap-1 rounded-pill bg-accent-tint text-accent font-sans text-[10px] font-bold tracking-cta px-2 py-0.5">
                ✓ READY
              </span>
              <p className="font-sans text-caption text-ink mt-1">
                Hairstyle ready · {hairSource.origin === 'upload' ? 'uploaded' : 'from page'}
              </p>
            </div>
            <button
              type="button"
              onClick={(): void => void clearHair()}
              className="font-sans text-[10px] font-semibold uppercase tracking-cta text-mute hover:text-accent transition-colors duration-200 px-2 py-1"
              aria-label="Remove"
            >
              REMOVE
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="rounded-card bg-accent-tint border border-accent-ring p-3 flex items-start gap-3">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-pill bg-accent text-bone shrink-0 font-sans text-[12px] font-bold">
                ✦
              </span>
              <p className="font-sans text-caption text-ink">
                Right-click any hairstyle image on a page →{' '}
                <span className="font-semibold text-accent">Use this hairstyle in TRY · ON</span>.
                Or upload one below.
              </p>
            </div>
            <input
              type="file"
              accept="image/*"
              onChange={(e): void => {
                const f = e.target.files?.[0];
                if (f) void uploadHair(f);
              }}
              className="block w-full text-caption text-ink file:mr-3 file:rounded-pill file:border file:border-accent-ring file:bg-bone file:px-3 file:py-1.5 file:font-sans file:text-[10px] file:font-semibold file:uppercase file:tracking-cta file:text-accent hover:file:bg-accent-tint hover:file:border-accent file:transition-colors file:duration-200"
            />
          </div>
        )}
      </Step>

      {phase === 'loading' && <ResultSkeleton />}

      {phase === 'done' && result && msTaken !== null && (
        <ResultViewer
          imageUrl={result.full_data_url}
          msTaken={msTaken}
          generationId={result.id}
          sequence={sequenceRef.current}
          onDownload={(): void => {
            const a = document.createElement('a');
            a.href = result.full_data_url;
            a.download = `tryon-hair-${result.id}.png`;
            a.click();
          }}
          onRegenerate={(): void => void generate()}
          onStartOver={(): void => void startOver()}
        />
      )}

      {phase === 'idle' && (
        <section className="space-y-3 -mx-5 px-5 pt-4 border-t border-rule">
          <Button variant="primary" size="md" fullWidth disabled={!canGenerate} onClick={(): void => void generate()}>
            Try this hairstyle
            {canGenerate && (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className="h-4 w-4" strokeLinecap="round" strokeLinejoin="round">
                <line x1="5" y1="12" x2="19" y2="12" />
                <polyline points="12 5 19 12 12 19" />
              </svg>
            )}
          </Button>
        </section>
      )}

      {phase === 'error' && (
        <section className="space-y-3 rounded-card bg-paper-subtle border border-rule p-4">
          <p className="font-sans text-caption text-mute">{errorMsg}</p>
          <Button variant="secondary" size="sm" onClick={(): void => void generate()}>
            Try again
          </Button>
        </section>
      )}
    </main>
  );
}

function Step({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <section className="rounded-card bg-bone border border-rule p-4 shadow-card space-y-3">
      <div className="flex items-center gap-2">
        <span className="inline-flex h-6 w-6 items-center justify-center rounded-pill bg-accent text-bone font-sans text-[10px] font-bold">
          {String(n).padStart(2, '0')}
        </span>
        <h3 className="font-display text-h2 font-semibold text-ink">{title}</h3>
      </div>
      {children}
    </section>
  );
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = (): void => resolve(String(r.result));
    r.onerror = (): void => reject(new Error('file_read_failed'));
    r.readAsDataURL(file);
  });
}
