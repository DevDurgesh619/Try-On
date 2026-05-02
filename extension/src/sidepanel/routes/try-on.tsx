import { useEffect, useState } from 'react';
import { send } from '../messaging';
import { compressImage } from '@/lib/image';
import type {
  AccessoriesMode,
  OutfitType,
  PendingAccessory,
  PendingGarment,
  ReferencePhoto,
  RecentResult,
} from '@/lib/types';

type Phase = 'idle' | 'loading' | 'done' | 'error';

const ACCESSORY_MODE_LABEL: Record<AccessoriesMode, string> = {
  off: 'No accessories',
  model: "Use the model's accessories",
  custom: 'Pick my own accessories',
};

const OUTFIT_TYPE_LABEL: Record<OutfitType, string> = {
  full: 'Full body outfit (one image with both top and bottom)',
  split: 'Top + Bottom (separate images)',
};

export function TryOn(): JSX.Element {
  const [photos, setPhotos] = useState<ReferencePhoto[]>([]);
  const [activePhotoId, setActivePhotoId] = useState<string | null>(null);
  const [outfitType, setOutfitType] = useState<OutfitType>('full');
  const [garments, setGarments] = useState<PendingGarment[]>([]);
  const [accessoriesMode, setAccessoriesMode] = useState<AccessoriesMode>('off');
  const [accessories, setAccessories] = useState<PendingAccessory[]>([]);
  const [phase, setPhase] = useState<Phase>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [result, setResult] = useState<RecentResult | null>(null);
  const [msTaken, setMsTaken] = useState<number | null>(null);

  async function refreshState(): Promise<void> {
    const r = await send({ type: 'GET_TRYON_STATE' });
    if (r.ok && 'outfitType' in r) {
      setOutfitType(r.outfitType);
      setGarments(r.garments);
      setAccessoriesMode(r.accessoriesMode);
      setAccessories(r.accessories);
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
        'outfit_type' in changes
      ) {
        void refreshState();
      }
    };
    chrome.storage.onChanged.addListener(listener);
    return (): void => chrome.storage.onChanged.removeListener(listener);
  }, []);

  async function changeOutfitType(t: OutfitType): Promise<void> {
    await send({ type: 'SET_OUTFIT_TYPE', outfitType: t });
    await refreshState();
  }

  async function changeAccessoriesMode(mode: AccessoriesMode): Promise<void> {
    await send({ type: 'SET_ACCESSORIES_MODE', mode });
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

  async function uploadAccessory(file: File): Promise<void> {
    const dataUrl = await readAsDataUrl(file);
    const compressed = await compressImage(dataUrl, 1024, 0.85);
    await send({
      type: 'ADD_PENDING_ACCESSORY',
      accessory: { url: compressed.data_url, origin: 'upload' },
    });
    await refreshState();
  }

  async function clearAll(): Promise<void> {
    await send({ type: 'CLEAR_PENDING_GARMENTS' });
    await send({ type: 'CLEAR_PENDING_ACCESSORIES' });
    setResult(null);
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
      ...(accessories.length > 0
        ? { accessoryUrls: accessories.map((a) => a.url) }
        : {}),
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

  // ---------- derived state ----------

  const garmentsValid =
    outfitType === 'full'
      ? garments.length === 1 && garments[0]?.slot === 'full'
      : isValidSplitCombo(garments);
  const accessoriesValid = accessoriesMode !== 'custom' || accessories.length > 0;
  const hasReference = photos.length > 0 && !!activePhotoId;
  const canGenerate = garmentsValid && accessoriesValid && hasReference;

  const nextHint = computeNextHint({
    photos,
    outfitType,
    garments,
    accessoriesMode,
    accessories,
  });

  if (photos.length === 0) {
    return (
      <main className="p-4 text-sm text-gray-700">
        Add a reference photo first under Settings.
      </main>
    );
  }

  return (
    <main className="space-y-5 p-4">
      <Step n={1} title="Choose what kind of outfit">
        <RadioGroup
          value={outfitType}
          onChange={(v): void => void changeOutfitType(v)}
          options={[
            { value: 'full', label: OUTFIT_TYPE_LABEL.full },
            { value: 'split', label: OUTFIT_TYPE_LABEL.split },
          ]}
        />
      </Step>

      <Step n={2} title="Choose accessories">
        <RadioGroup
          value={accessoriesMode}
          onChange={(v): void => void changeAccessoriesMode(v)}
          options={(['off', 'model', 'custom'] as AccessoriesMode[]).map((m) => ({
            value: m,
            label: ACCESSORY_MODE_LABEL[m],
          }))}
        />
      </Step>

      <Step n={3} title="Pick images from any page">
        {nextHint && (
          <p className="rounded border border-blue-200 bg-blue-50 p-2 text-xs text-blue-900">
            {nextHint}
          </p>
        )}

        <GarmentStrip
          outfitType={outfitType}
          garments={garments}
          onRemove={(i): void => void removeGarment(i)}
        />

        {accessoriesMode === 'custom' && (
          <AccessoryStrip
            accessories={accessories}
            onRemove={(i): void => void removeAccessory(i)}
            onUpload={(f): void => void uploadAccessory(f)}
          />
        )}
      </Step>

      <section>
        <div className="mb-1 text-xs font-medium text-gray-700">Reference photo</div>
        <div className="flex gap-2 overflow-x-auto">
          {photos.map((p) => (
            <button
              key={p.id}
              onClick={(): void => setActivePhotoId(p.id)}
              className={`shrink-0 rounded border p-1 ${
                activePhotoId === p.id ? 'border-black' : 'border-gray-200'
              }`}
              title={p.label}
            >
              <img src={p.data_url} alt={p.label} className="h-16 w-16 rounded object-cover" />
            </button>
          ))}
        </div>
      </section>

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
              download={`tryon-${result.id}.png`}
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
              onClick={(): void => void clearAll()}
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
          Try it on
        </button>
      )}
    </main>
  );
}

// ---------- subcomponents ----------

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

interface RadioGroupProps<T extends string> {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}
function RadioGroup<T extends string>({ value, onChange, options }: RadioGroupProps<T>): JSX.Element {
  return (
    <div className="space-y-1">
      {options.map((o) => (
        <label
          key={o.value}
          className={`flex cursor-pointer items-start gap-2 rounded border p-2 text-xs ${
            value === o.value ? 'border-black bg-gray-50' : 'border-gray-200'
          }`}
        >
          <input
            type="radio"
            checked={value === o.value}
            onChange={(): void => onChange(o.value)}
            className="mt-0.5"
          />
          <span>{o.label}</span>
        </label>
      ))}
    </div>
  );
}

function GarmentStrip({
  outfitType,
  garments,
  onRemove,
}: {
  outfitType: OutfitType;
  garments: PendingGarment[];
  onRemove: (i: number) => void;
}): JSX.Element {
  const top = garments.find((g) => g.slot === 'top') ?? null;
  const bottom = garments.find((g) => g.slot === 'bottom') ?? null;
  const fullGarment = garments.find((g) => g.slot === 'full') ?? null;

  return (
    <div className="space-y-2">
      <div className="text-xs text-gray-500">
        {outfitType === 'full'
          ? `Garments (${garments.length}/1)`
          : `Garments (${garments.length}/2 — the empty slot stays from your reference photo)`}
      </div>
      {outfitType === 'full' ? (
        <SlotRow
          label="Full outfit"
          garment={fullGarment}
          onRemove={fullGarment ? (): void => onRemove(garments.indexOf(fullGarment)) : undefined}
        />
      ) : (
        <>
          <SlotRow
            label="Top"
            garment={top}
            onRemove={top ? (): void => onRemove(garments.indexOf(top)) : undefined}
          />
          <SlotRow
            label="Bottom"
            garment={bottom}
            onRemove={bottom ? (): void => onRemove(garments.indexOf(bottom)) : undefined}
          />
        </>
      )}
    </div>
  );
}

function SlotRow({
  label,
  garment,
  onRemove,
}: {
  label: string;
  garment: PendingGarment | null;
  onRemove?: (() => void) | undefined;
}): JSX.Element {
  return (
    <div className="flex items-center gap-3 rounded border border-gray-200 p-2">
      {garment ? (
        <img src={garment.url} alt={label} className="h-14 w-14 rounded object-cover" />
      ) : (
        <div className="flex h-14 w-14 items-center justify-center rounded border border-dashed border-gray-300 text-[10px] text-gray-400">
          empty
        </div>
      )}
      <div className="flex-1 text-xs">
        <div className="font-medium text-gray-800">{label}</div>
        <div className="text-gray-500">
          {garment
            ? 'will be applied'
            : 'optional — leave empty to keep your reference photo’s ' + label.toLowerCase()}
        </div>
      </div>
      {onRemove && (
        <button
          onClick={onRemove}
          className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
        >
          ×
        </button>
      )}
    </div>
  );
}

function AccessoryStrip({
  accessories,
  onRemove,
  onUpload,
}: {
  accessories: PendingAccessory[];
  onRemove: (i: number) => void;
  onUpload: (f: File) => void;
}): JSX.Element {
  return (
    <div className="space-y-2 rounded border border-gray-200 p-2">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium text-gray-800">Accessories ({accessories.length})</span>
        <span className="text-gray-500">
          right-click → &ldquo;Use as accessory in TryOn&rdquo;, or upload below
        </span>
      </div>
      {accessories.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {accessories.map((a, i) => (
            <li key={`${a.url}-${i}`} className="relative">
              <img src={a.url} alt="" className="h-14 w-14 rounded border border-gray-200 object-cover" />
              <button
                onClick={(): void => onRemove(i)}
                className="absolute -right-1 -top-1 rounded-full border border-gray-300 bg-white px-1 text-[10px] font-bold leading-none text-gray-700 hover:bg-gray-50"
                aria-label="Remove"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <input
        type="file"
        accept="image/*"
        onChange={(e): void => {
          const f = e.target.files?.[0];
          if (f) onUpload(f);
        }}
        className="block w-full text-xs"
      />
    </div>
  );
}

function ResultSkeleton(): JSX.Element {
  return (
    <div className="space-y-2">
      <div className="h-64 w-full animate-pulse rounded bg-gray-200" />
      <p className="text-xs text-gray-500">
        Generating… usually 8–15 seconds. Placeholder mode is on by default; flip{' '}
        <code className="rounded bg-gray-100 px-1">use_placeholder_images</code> off in settings to
        call the live model.
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

// ---------- helpers ----------

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = (): void => resolve(String(r.result));
    r.onerror = (): void => reject(new Error('file_read_failed'));
    r.readAsDataURL(file);
  });
}

function isValidSplitCombo(garments: PendingGarment[]): boolean {
  // 'split' mode now accepts: 1 top alone, 1 bottom alone, or 1 top + 1 bottom.
  // (Backend already maps each case to OUTFIT_TOP / OUTFIT_BOTTOM / OUTFIT_TOP_AND_BOTTOM.)
  if (garments.length === 1) {
    return garments[0]?.slot === 'top' || garments[0]?.slot === 'bottom';
  }
  if (garments.length === 2) {
    const slots = garments.map((g) => g.slot).sort().join(',');
    return slots === 'bottom,top';
  }
  return false;
}

function computeNextHint(args: {
  photos: ReferencePhoto[];
  outfitType: OutfitType;
  garments: PendingGarment[];
  accessoriesMode: AccessoriesMode;
  accessories: PendingAccessory[];
}): string | null {
  if (args.photos.length === 0) {
    return 'Add a reference photo under Settings.';
  }
  if (args.outfitType === 'full') {
    if (args.garments.length === 0) {
      return 'Right-click a full-outfit product image → "Try this on with TryOn".';
    }
  } else {
    const hasTop = args.garments.some((g) => g.slot === 'top');
    const hasBottom = args.garments.some((g) => g.slot === 'bottom');
    if (!hasTop && !hasBottom) {
      return 'Right-click a TOP or BOTTOM product image → "Try this on with TryOn". You can pick just one — the other half stays from your reference photo.';
    }
    // 1 garment present is now valid; the second slot is optional. Surface it as
    // a soft prompt only when accessories aren't pulling focus.
    if (args.accessoriesMode !== 'custom' || args.accessories.length > 0) {
      if (!hasTop) {
        return 'Optional: add a TOP image, or click Try it on to swap only the bottom.';
      }
      if (!hasBottom) {
        return 'Optional: add a BOTTOM image, or click Try it on to swap only the top.';
      }
    }
  }
  if (args.accessoriesMode === 'custom' && args.accessories.length === 0) {
    return 'Add an accessory: right-click any image → "Use as accessory in TryOn", or upload one.';
  }
  return null; // ready to generate
}
