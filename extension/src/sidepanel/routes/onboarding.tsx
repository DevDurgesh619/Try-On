import { useRef, useState } from 'react';
import { compressImage } from '@/lib/image';
import { send } from '../messaging';
import type { ReferencePhotoType } from '@/lib/types';
import { Badge } from '../components/ui/Badge';
import { TextField } from '../components/ui/TextField';
import { useToast } from '../components/ui/Toast';
import { humanizeError } from '../components/ui/errors';

interface Props {
  onDone: () => void;
}

export function Onboarding({ onDone }: Props): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [type, setType] = useState<ReferencePhotoType>('full_body');
  const [label, setLabel] = useState('front - daylight');
  const fileRef = useRef<HTMLInputElement>(null);
  const toast = useToast();

  async function handleFile(file: File): Promise<void> {
    setBusy(true);
    try {
      const dataUrl = await readAsDataUrl(file);
      const compressed = await compressImage(dataUrl);
      const r = await send({
        type: 'SAVE_PHOTO',
        label,
        photoType: type,
        data_url: compressed.data_url,
      });
      if (!r.ok) {
        toast.show(humanizeError(r.code, r.message), 'signal');
        return;
      }
      toast.show('Reference saved.', 'signal');
      onDone();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'failed';
      toast.show(msg, 'signal');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="space-y-6 px-5 py-7">
      <header className="space-y-2">
        <Badge tone="signal">◆ Step 01 — Start here</Badge>
        <h2 className="font-display text-display-xl font-semibold text-ink">
          Your <span className="italic text-accent">reference</span> photo.
        </h2>
        <p className="font-sans text-body text-mute max-w-[440px]">
          One photo, on your device. The model uses it as the canvas for every try-on.
        </p>
      </header>

      <section className="space-y-5">
        <div>
          <span className="block font-sans text-caption font-medium text-mute mb-2">
            Photo type
          </span>
          <div className="flex gap-2">
            <PhotoTypeChip value="full_body" current={type} onPick={setType} label="Full body" hint="for clothing" />
            <PhotoTypeChip value="face" current={type} onPick={setType} label="Face" hint="for hair" />
          </div>
        </div>

        <TextField
          label="Label"
          value={label}
          onChange={(e): void => setLabel(e.target.value)}
          placeholder="front - daylight"
        />

        <button
          type="button"
          onClick={(): void => fileRef.current?.click()}
          disabled={busy}
          className="flex w-full h-52 rounded-card border-2 border-dashed border-rule bg-paper-subtle hover:border-accent hover:bg-accent-tint transition-colors duration-200 ease-editorial flex-col items-center justify-center gap-3 disabled:opacity-50"
        >
          <span className="flex h-12 w-12 items-center justify-center rounded-pill bg-bone border border-accent-ring shadow-card">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6 text-accent">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
          </span>
          <span className="font-display text-h2 font-semibold text-ink">
            {busy ? 'Saving…' : 'Drop a photo, or browse'}
          </span>
          <span className="font-sans text-[10px] font-semibold uppercase tracking-cta text-accent">
            JPG · PNG · max 10 MB
          </span>
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e): void => {
            const f = e.target.files?.[0];
            if (f) void handleFile(f);
          }}
        />
      </section>

      <p className="font-sans text-caption text-mute pt-4 border-t border-rule">
        Used only to generate try-ons. Photos stay on your device — they are sent only as part of a
        single try-on request and never stored on our servers.
      </p>
    </main>
  );
}

interface PhotoTypeChipProps {
  value: ReferencePhotoType;
  current: ReferencePhotoType;
  onPick: (v: ReferencePhotoType) => void;
  label: string;
  hint: string;
}

function PhotoTypeChip({ value, current, onPick, label, hint }: PhotoTypeChipProps): JSX.Element {
  const active = value === current;
  return (
    <button
      type="button"
      onClick={(): void => onPick(value)}
      className={[
        'flex-1 text-left p-3 rounded-card border transition-all duration-200 ease-editorial',
        active
          ? 'bg-accent-tint border-accent-ring shadow-card'
          : 'bg-bone border-rule hover:border-accent-ring',
      ].join(' ')}
    >
      <span className={['block font-display text-h2 font-semibold', active ? 'text-accent' : 'text-ink'].join(' ')}>
        {label}
      </span>
      <span className="block font-sans text-caption text-mute mt-0.5">{hint}</span>
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
