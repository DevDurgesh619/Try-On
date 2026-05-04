import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { send } from '../messaging';
import { compressImage } from '@/lib/image';
import type {
  AccessoriesMode,
  PendingAccessory,
  PendingGarment,
  PendingHairSource,
  PendingTarget,
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

interface TargetDef {
  value: PendingTarget;
  title: string;
  hint: string;
}

const TARGETS: TargetDef[] = [
  { value: 'full', title: 'Full body outfit', hint: 'one image with both top and bottom' },
  { value: 'top', title: 'Top only', hint: "your reference photo's bottom stays" },
  { value: 'bottom', title: 'Bottom only', hint: "your reference photo's top stays" },
  { value: 'accessory', title: 'Accessory', hint: 'a watch, glasses, bag, anything' },
  { value: 'hair', title: 'Hairstyle', hint: 'try a haircut on top of the outfit' },
];

export function TryOn(): JSX.Element {
  const [photos, setPhotos] = useState<ReferencePhoto[]>([]);
  const [activePhotoId, setActivePhotoId] = useState<string | null>(null);
  const [pendingTarget, setPendingTarget] = useState<PendingTarget>('full');
  const [garments, setGarments] = useState<PendingGarment[]>([]);
  const [accessoriesMode, setAccessoriesMode] = useState<AccessoriesMode>('off');
  const [accessories, setAccessories] = useState<PendingAccessory[]>([]);
  const [outfitHairSource, setOutfitHairSource] = useState<PendingHairSource | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [result, setResult] = useState<RecentResult | null>(null);
  const [msTaken, setMsTaken] = useState<number | null>(null);
  const sequenceRef = useRef(0);
  const navigate = useNavigate();
  const toast = useToast();

  async function refreshState(): Promise<void> {
    const r = await send({ type: 'GET_TRYON_STATE' });
    if (r.ok && 'pendingTarget' in r) {
      setPendingTarget(r.pendingTarget);
      setGarments(r.garments);
      setAccessoriesMode(r.accessoriesMode);
      setAccessories(r.accessories);
      setOutfitHairSource(r.outfitHairSource);
    }
  }

  useEffect(() => {
    void (async (): Promise<void> => {
      const p = await send({ type: 'LIST_PHOTOS' });
      if (p.ok && 'photos' in p) {
        setPhotos(p.photos);
        setActivePhotoId(p.photos[0]?.id ?? null);
      }
      await refreshState();
    })();
  }, []);

  useEffect(() => {
    const listener = (
      changes: { [k: string]: chrome.storage.StorageChange },
      area: chrome.storage.AreaName,
    ): void => {
      if (area !== 'session') return;
      if (
        'pending_garments' in changes ||
        'pending_accessories' in changes ||
        'accessories_mode' in changes ||
        'pending_target' in changes ||
        'pending_outfit_hair_source' in changes
      ) {
        void refreshState();
      }
    };
    chrome.storage.onChanged.addListener(listener);
    return (): void => chrome.storage.onChanged.removeListener(listener);
  }, []);

  async function changeTarget(target: PendingTarget): Promise<void> {
    await send({ type: 'SET_PENDING_TARGET', target });
    await refreshState();
  }

  async function removeGarment(index: number): Promise<void> {
    await send({ type: 'REMOVE_PENDING_GARMENT', index });
    await refreshState();
  }

  async function removeAccessory(index: number): Promise<void> {
    await send({ type: 'REMOVE_PENDING_ACCESSORY', index });
    await refreshState();
  }

  async function clearOutfitHair(): Promise<void> {
    await send({ type: 'CLEAR_PENDING_OUTFIT_HAIR_SOURCE' });
    await refreshState();
  }

  async function uploadFor(target: PendingTarget, file: File): Promise<void> {
    const dataUrl = await readAsDataUrl(file);
    const compressed = await compressImage(dataUrl, 1024, 0.85);
    if (target === 'accessory') {
      await send({
        type: 'ADD_PENDING_ACCESSORY',
        accessory: { url: compressed.data_url, origin: 'upload' },
      });
    } else if (target === 'hair') {
      await send({
        type: 'SET_PENDING_OUTFIT_HAIR_SOURCE',
        source: { url: compressed.data_url, origin: 'upload' },
      });
    } else {
      await send({
        type: 'ADD_PENDING_GARMENT',
        garment: { slot: target, url: compressed.data_url, origin: 'upload' },
      });
    }
    await refreshState();
  }

  async function toggleModelAccessories(on: boolean): Promise<void> {
    await send({ type: 'SET_ACCESSORIES_MODE', mode: on ? 'model' : 'off' });
    await refreshState();
  }

  async function clearAll(): Promise<void> {
    await send({ type: 'CLEAR_PENDING_GARMENTS' });
    await send({ type: 'CLEAR_PENDING_ACCESSORIES' });
    await send({ type: 'CLEAR_PENDING_OUTFIT_HAIR_SOURCE' });
    await send({ type: 'SET_ACCESSORIES_MODE', mode: 'off' });
    setResult(null);
    setMsTaken(null);
    setPhase('idle');
    await refreshState();
  }

  async function generate(): Promise<void> {
    if (!canGenerate || !activePhotoId) return;
    setPhase('loading');
    setErrorMsg(null);
    const r = await send({
      type: 'GENERATE',
      mode: 'outfit',
      garments: garments.map((g) => ({ slot: g.slot, sourceImageUrl: g.url })),
      referencePhotoId: activePhotoId,
      accessoriesMode,
      ...(accessoriesMode === 'custom' && accessories.length > 0
        ? { accessoryUrls: accessories.map((a) => a.url) }
        : {}),
      ...(outfitHairSource ? { outfitHairSourceUrl: outfitHairSource.url } : {}),
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

  const top = garments.find((g) => g.slot === 'top') ?? null;
  const bottom = garments.find((g) => g.slot === 'bottom') ?? null;
  const fullGarment = garments.find((g) => g.slot === 'full') ?? null;
  const garmentsValid = !!fullGarment || !!top || !!bottom;
  const accessoriesValid = accessoriesMode !== 'custom' || accessories.length > 0;
  const hasReference = photos.length > 0 && !!activePhotoId;
  const canGenerate = garmentsValid && accessoriesValid && hasReference;

  if (photos.length === 0) {
    return (
      <main className="px-5">
        <EmptyState
          eyebrow="Step 01"
          title="Add a reference photo."
          body="Upload one full-body photo under Settings. It stays on your device and powers every try-on."
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
    <main className="space-y-7 px-5 py-6">
      <header className="space-y-2">
        <Badge tone="signal">◆ Look Builder</Badge>
        <h2 className="font-display text-display-lg font-semibold text-ink">
          Compose your <span className="italic text-accent">try-on.</span>
        </h2>
        <p className="font-sans text-caption text-mute max-w-[440px]">
          Pick a slot to fill, then on any page hover an image and click the{' '}
          <span className="font-semibold text-accent">Try On</span> mark. Empty slots keep what your
          reference photo already has.
        </p>
      </header>

      <section className="space-y-3">
        {TARGETS.map((t) => (
          <TargetRow
            key={t.value}
            def={t}
            active={pendingTarget === t.value}
            onActivate={(): void => void changeTarget(t.value)}
            onUpload={(f): void => void uploadFor(t.value, f)}
            top={top}
            bottom={bottom}
            fullGarment={fullGarment}
            accessories={accessories}
            outfitHairSource={outfitHairSource}
            onRemoveGarment={(i): void => void removeGarment(i)}
            onRemoveAccessory={(i): void => void removeAccessory(i)}
            onClearHair={(): void => void clearOutfitHair()}
            garmentsByUrl={garments}
          />
        ))}
      </section>

      <section className="rounded-card bg-paper-subtle border border-rule p-4">
        <ToggleRow
          label="Use accessories from the source models"
          hint="Mutually exclusive with picking your own accessory."
          checked={accessoriesMode === 'model'}
          onChange={(v): void => void toggleModelAccessories(v)}
        />
      </section>

      <section className="space-y-3">
        <div className="flex items-baseline gap-2">
          <Badge tone="signal">◆ Reference photo</Badge>
        </div>
        <div className="flex gap-3 overflow-x-auto pb-1">
          {photos.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={(): void => setActivePhotoId(p.id)}
              className="shrink-0"
              title={p.label}
            >
              <span
                className={[
                  'block rounded-card transition-all duration-200 ease-editorial',
                  activePhotoId === p.id
                    ? 'p-[3px] ring-2 ring-accent ring-offset-2 ring-offset-paper'
                    : 'p-[3px] hover:ring-1 hover:ring-rule',
                ].join(' ')}
              >
                <img
                  src={p.data_url}
                  alt={p.label}
                  className="block h-16 w-16 object-cover rounded-sm"
                />
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
      </section>

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
            a.download = `tryon-${result.id}.png`;
            a.click();
          }}
          onRegenerate={(): void => void generate()}
          onStartOver={(): void => void clearAll()}
        />
      )}

      {phase === 'idle' && (
        <section className="space-y-3 -mx-5 px-5 pt-4 border-t border-rule">
          {!garmentsValid && (
            <Badge tone="signal">Pick a garment slot to continue</Badge>
          )}
          {garmentsValid && accessoriesMode === 'custom' && accessories.length === 0 && (
            <Badge tone="signal">Add an accessory or switch off custom mode</Badge>
          )}
          <Button variant="primary" size="md" fullWidth disabled={!canGenerate} onClick={(): void => void generate()}>
            Try it on
            {canGenerate && (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className="h-4 w-4" strokeLinecap="round" strokeLinejoin="round">
                <line x1="5" y1="12" x2="19" y2="12" />
                <polyline points="12 5 19 12 12 19" />
              </svg>
            )}
          </Button>
          {pendingTarget === 'hair' && outfitHairSource && (
            <p className="font-sans text-caption text-mute text-center">
              Want sharper hair?{' '}
              <Link to="/hair" className="font-semibold text-accent underline underline-offset-4 decoration-accent-ring hover:decoration-accent">
                Switch to the Hair tab
              </Link>
            </p>
          )}
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

interface TargetRowProps {
  def: TargetDef;
  active: boolean;
  onActivate: () => void;
  onUpload: (f: File) => void;
  top: PendingGarment | null;
  bottom: PendingGarment | null;
  fullGarment: PendingGarment | null;
  accessories: PendingAccessory[];
  outfitHairSource: PendingHairSource | null;
  onRemoveGarment: (index: number) => void;
  onRemoveAccessory: (index: number) => void;
  onClearHair: () => void;
  garmentsByUrl: PendingGarment[];
}

function TargetRow({
  def,
  active,
  onActivate,
  onUpload,
  top,
  bottom,
  fullGarment,
  accessories,
  outfitHairSource,
  onRemoveGarment,
  onRemoveAccessory,
  onClearHair,
  garmentsByUrl,
}: TargetRowProps): JSX.Element {
  return (
    <div
      className={[
        'rounded-card border transition-all duration-200 ease-editorial',
        active
          ? 'bg-accent-tint border-accent-ring shadow-card'
          : 'bg-bone border-rule hover:border-accent-ring',
      ].join(' ')}
    >
      <div className="px-4 py-3">
        <button
          type="button"
          onClick={onActivate}
          className="flex w-full items-center justify-between text-left gap-3 cursor-pointer group"
        >
          <span className="flex-1 min-w-0">
            <span className="block font-display text-h2 font-semibold text-ink">{def.title}</span>
            <span className="block font-sans text-caption text-mute mt-0.5">{def.hint}</span>
          </span>
          {active ? (
            <span className="shrink-0 inline-flex items-center gap-1.5 rounded-pill bg-accent text-bone font-sans text-[10px] font-bold tracking-cta px-2.5 py-1">
              <span className="h-1.5 w-1.5 rounded-pill bg-bone" />
              ACTIVE
            </span>
          ) : (
            <span className="shrink-0 inline-flex items-center gap-1.5 rounded-pill bg-paper-subtle text-ink font-sans text-[10px] font-semibold tracking-cta px-2.5 py-1 group-hover:bg-accent-tint group-hover:text-accent transition-colors duration-200">
              PICK
              <span className="transition-transform duration-200 group-hover:translate-x-0.5">→</span>
            </span>
          )}
        </button>

        <div className="mt-3">
          {def.value === 'full' && (
            <SlotPreview
              garment={fullGarment}
              onRemove={fullGarment ? (): void => onRemoveGarment(garmentsByUrl.indexOf(fullGarment)) : undefined}
              emptyLabel="Empty — pick a full-outfit image"
            />
          )}
          {def.value === 'top' && (
            <SlotPreview
              garment={top}
              onRemove={top ? (): void => onRemoveGarment(garmentsByUrl.indexOf(top)) : undefined}
              emptyLabel="Empty — your reference photo's top stays"
            />
          )}
          {def.value === 'bottom' && (
            <SlotPreview
              garment={bottom}
              onRemove={bottom ? (): void => onRemoveGarment(garmentsByUrl.indexOf(bottom)) : undefined}
              emptyLabel="Empty — your reference photo's bottom stays"
            />
          )}
          {def.value === 'accessory' && (
            <AccessoryList accessories={accessories} onRemove={onRemoveAccessory} />
          )}
          {def.value === 'hair' && (
            <SlotPreview
              garment={outfitHairSource ? { slot: 'full', url: outfitHairSource.url, origin: 'context_menu' } : null}
              onRemove={outfitHairSource ? onClearHair : undefined}
              emptyLabel="Empty — your reference photo's hair stays"
            />
          )}

          {active && (
            <div className="mt-3">
              <FilePicker onPick={onUpload} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function FilePicker({ onPick }: { onPick: (f: File) => void }): JSX.Element {
  return (
    <label className="block cursor-pointer">
      <span className="block font-sans text-[10px] font-semibold uppercase tracking-cta text-mute mb-1.5">
        Or upload from disk
      </span>
      <input
        type="file"
        accept="image/*"
        onChange={(e): void => {
          const f = e.target.files?.[0];
          if (f) onPick(f);
        }}
        className="block w-full text-caption text-ink file:mr-3 file:rounded-pill file:border file:border-accent-ring file:bg-bone file:px-3 file:py-1.5 file:font-sans file:text-[10px] file:font-semibold file:uppercase file:tracking-cta file:text-accent hover:file:bg-accent-tint hover:file:border-accent file:transition-colors file:duration-200"
      />
    </label>
  );
}

function SlotPreview({
  garment,
  onRemove,
  emptyLabel,
}: {
  garment: PendingGarment | null;
  onRemove?: (() => void) | undefined;
  emptyLabel: string;
}): JSX.Element {
  if (!garment) {
    return (
      <div className="flex h-16 items-center gap-3 rounded-card border border-dashed border-rule bg-bone px-3">
        <span className="inline-flex h-6 w-6 items-center justify-center rounded-pill bg-paper-subtle text-mute-soft text-[10px] shrink-0">
          ◯
        </span>
        <span className="font-sans text-caption text-mute italic">{emptyLabel}</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-3 rounded-card bg-bone border border-accent-ring p-2 shadow-card">
      <img src={garment.url} alt="" className="h-16 w-16 object-cover rounded-sm" />
      <span className="flex-1 min-w-0">
        <span className="inline-flex items-center gap-1 rounded-pill bg-accent-tint text-accent font-sans text-[10px] font-bold tracking-cta px-2 py-0.5">
          ✓ READY
        </span>
        <span className="block font-sans text-caption text-ink mt-1">Will be applied</span>
      </span>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="font-sans text-[10px] font-semibold uppercase tracking-cta text-mute hover:text-accent transition-colors duration-200 px-2 py-1"
          aria-label="Remove"
        >
          REMOVE
        </button>
      )}
    </div>
  );
}

function AccessoryList({
  accessories,
  onRemove,
}: {
  accessories: PendingAccessory[];
  onRemove: (i: number) => void;
}): JSX.Element {
  if (accessories.length === 0) {
    return (
      <div className="flex h-16 items-center gap-3 rounded-card border border-dashed border-rule bg-bone px-3">
        <span className="inline-flex h-6 w-6 items-center justify-center rounded-pill bg-paper-subtle text-mute-soft text-[10px] shrink-0">
          ◯
        </span>
        <span className="font-sans text-caption text-mute italic">
          Empty — your reference photo&rsquo;s accessories stay
        </span>
      </div>
    );
  }
  return (
    <ul className="flex flex-wrap gap-2">
      {accessories.map((a, i) => (
        <li key={`${a.url}-${i}`} className="relative">
          <img src={a.url} alt="" className="h-14 w-14 object-cover rounded-sm border border-accent-ring" />
          <button
            type="button"
            onClick={(): void => onRemove(i)}
            className="absolute -right-1.5 -top-1.5 h-5 w-5 rounded-pill bg-bone border border-accent-ring text-[11px] leading-none text-accent hover:bg-accent hover:text-bone hover:border-accent transition-colors duration-200 shadow-card"
            aria-label="Remove"
          >
            ×
          </button>
        </li>
      ))}
    </ul>
  );
}

interface ToggleRowProps {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}

function ToggleRow({ label, hint, checked, onChange }: ToggleRowProps): JSX.Element {
  return (
    <button
      type="button"
      onClick={(): void => onChange(!checked)}
      className="flex w-full items-start justify-between gap-3 text-left"
    >
      <span className="flex-1 min-w-0">
        <span className="block font-display text-h2 font-semibold text-ink">{label}</span>
        <span className="block font-sans text-caption text-mute mt-0.5">{hint}</span>
      </span>
      <span
        className={[
          'shrink-0 mt-1 relative inline-block h-5 w-9 rounded-pill transition-colors duration-200 ease-editorial',
          checked ? 'bg-accent' : 'bg-rule',
        ].join(' ')}
      >
        <span
          className={[
            'absolute top-0.5 h-4 w-4 rounded-pill bg-bone shadow-card transition-all duration-200 ease-editorial',
            checked ? 'left-[18px]' : 'left-0.5',
          ].join(' ')}
        />
      </span>
    </button>
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
