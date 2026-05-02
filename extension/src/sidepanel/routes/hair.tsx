import { useEffect, useState } from 'react';
import { send } from '../messaging';
import { compressImage } from '@/lib/image';
import type {
  PendingHairSource,
  ReferencePhoto,
  RecentResult,
} from '@/lib/types';

type Phase = 'idle' | 'loading' | 'done' | 'error';

export function Hair(): JSX.Element {
  const [photos, setPhotos] = useState<ReferencePhoto[]>([]);
  const [activePhotoId, setActivePhotoId] = useState<string | null>(null);
  const [hairSource, setHairSource] = useState<PendingHairSource | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [result, setResult] = useState<RecentResult | null>(null);
  const [msTaken, setMsTaken] = useState<number | null>(null);

  async function refreshHair(): Promise<void> {
    const r = await send({ type: 'GET_HAIR_STATE' });
    if (r.ok && 'source' in r) setHairSource(r.source);
  }

  useEffect(() => {
    void (async (): Promise<void> => {
      const p = await send({ type: 'LIST_PHOTOS' });
      if (p.ok && 'photos' in p) {
        // Prefer face photos for hair: sort face-first.
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
      setPhase('error');
      setErrorMsg(r.message);
      return;
    }
    if ('result' in r) {
      setResult(r.result);
      setMsTaken(r.ms_taken);
      setPhase('done');
    }
  }

  async function startOver(): Promise<void> {
    await clearHair();
    setResult(null);
    setPhase('idle');
  }

  const hasReference = photos.length > 0 && !!activePhotoId;
  const hasFacePhoto = photos.some((p) => p.type === 'face');
  const canGenerate = hasReference && !!hairSource;
  const activePhoto = photos.find((p) => p.id === activePhotoId) ?? null;

  if (photos.length === 0) {
    return (
      <main className="p-4 text-sm text-gray-700">
        Add a reference photo first under Settings (a face photo works best for hairstyles).
      </main>
    );
  }

  return (
    <main className="space-y-5 p-4">
      {!hasFacePhoto && (
        <p className="rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
          Tip: hair results are noticeably better with a <em>face</em> reference photo.
          Upload one under Settings.
        </p>
      )}

      <Step n={1} title="Choose your face photo">
        <div className="flex gap-2 overflow-x-auto">
          {photos.map((p) => (
            <button
              key={p.id}
              onClick={(): void => setActivePhotoId(p.id)}
              className={`shrink-0 rounded border p-1 ${
                activePhotoId === p.id ? 'border-black' : 'border-gray-200'
              }`}
              title={`${p.label} · ${p.type}`}
            >
              <img src={p.data_url} alt={p.label} className="h-16 w-16 rounded object-cover" />
            </button>
          ))}
        </div>
        {activePhoto && (
          <p className="mt-1 text-[11px] text-gray-500">
            Selected: {activePhoto.label} ({activePhoto.type === 'face' ? 'face' : 'full body'})
            {activePhoto.type !== 'face' && ' — face works better'}
          </p>
        )}
      </Step>

      <Step n={2} title="Pick a hairstyle reference">
        {hairSource ? (
          <div className="flex items-center gap-3 rounded border border-gray-200 p-2">
            <img
              src={hairSource.url}
              alt="hairstyle"
              className="h-20 w-20 rounded object-cover"
            />
            <div className="flex-1 text-xs text-gray-600">
              Hairstyle ready ({hairSource.origin === 'upload' ? 'uploaded' : 'from page'})
            </div>
            <button
              onClick={(): void => void clearHair()}
              className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
            >
              ×
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="rounded border border-blue-200 bg-blue-50 p-2 text-xs text-blue-900">
              Right-click any hairstyle image on a page → <em>Use this hairstyle in TryOn</em>,
              or upload one below.
            </p>
            <input
              type="file"
              accept="image/*"
              onChange={(e): void => {
                const f = e.target.files?.[0];
                if (f) void uploadHair(f);
              }}
              className="block w-full text-xs"
            />
          </div>
        )}
      </Step>

      {phase === 'loading' && <ResultSkeleton />}

      {phase === 'done' && result && (
        <section className="space-y-2">
          <img
            src={result.full_data_url}
            alt="result"
            className="w-full rounded border border-gray-200"
          />
          <div className="flex flex-wrap gap-2">
            <a
              href={result.full_data_url}
              download={`tryon-hair-${result.id}.png`}
              className="rounded bg-black px-3 py-1.5 text-xs font-medium text-white"
            >
              Download
            </a>
            <button
              onClick={(): void => void generate()}
              className="rounded border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-800 hover:bg-gray-50"
            >
              Regenerate
            </button>
            <button
              onClick={(): void => void startOver()}
              className="rounded border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-800 hover:bg-gray-50"
            >
              Start over
            </button>
          </div>
          <UsageIndicator msTaken={msTaken} />
        </section>
      )}

      {phase === 'error' && (
        <section className="space-y-2 rounded border border-red-200 bg-red-50 p-3 text-xs text-red-800">
          <p>{errorMsg ?? 'Something went wrong.'}</p>
          <button
            onClick={(): void => void generate()}
            className="rounded border border-red-300 bg-white px-3 py-1.5 font-medium text-red-700"
          >
            Try again
          </button>
        </section>
      )}

      {phase === 'idle' && (
        <button
          disabled={!canGenerate}
          onClick={(): void => void generate()}
          className="w-full rounded bg-black px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-gray-300"
        >
          Try this hairstyle
        </button>
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
    <section className="space-y-2">
      <div className="text-xs font-medium uppercase tracking-wide text-gray-500">
        Step {n} · {title}
      </div>
      {children}
    </section>
  );
}

function ResultSkeleton(): JSX.Element {
  return (
    <div className="space-y-2">
      <div className="h-64 w-full animate-pulse rounded bg-gray-200" />
      <p className="text-xs text-gray-500">
        Generating… usually 8–15 seconds.
      </p>
    </div>
  );
}

function UsageIndicator({ msTaken }: { msTaken: number | null }): JSX.Element | null {
  if (msTaken === null) return null;
  return (
    <p className="text-[11px] text-gray-500">
      Generated in {(msTaken / 1000).toFixed(1)}s · approx ₹4–6 per try-on
    </p>
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
