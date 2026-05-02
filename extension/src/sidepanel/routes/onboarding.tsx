import { useState } from 'react';
import { compressImage } from '@/lib/image';
import { send } from '../messaging';
import type { ReferencePhotoType } from '@/lib/types';

interface Props {
  onDone: () => void;
}

export function Onboarding({ onDone }: Props): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [type, setType] = useState<ReferencePhotoType>('full_body');
  const [label, setLabel] = useState('front - daylight');

  async function handleFile(file: File): Promise<void> {
    setBusy(true);
    setError(null);
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
        setError(r.message);
        return;
      }
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="space-y-4 p-4">
      <div>
        <h2 className="text-base font-semibold">Add your first reference photo</h2>
        <p className="mt-1 text-xs text-gray-600">
          Used only to generate try-ons. Photos stay on your device — they are sent only as part of a
          single try-on request and never stored on our servers.
        </p>
      </div>

      <label className="block text-xs font-medium text-gray-700">
        Photo type
        <select
          className="mt-1 block w-full rounded border border-gray-300 px-2 py-1 text-sm"
          value={type}
          onChange={(e): void => setType(e.target.value as ReferencePhotoType)}
        >
          <option value="full_body">Full body (for clothing)</option>
          <option value="face">Face (for hair / beard)</option>
        </select>
      </label>

      <label className="block text-xs font-medium text-gray-700">
        Label
        <input
          className="mt-1 block w-full rounded border border-gray-300 px-2 py-1 text-sm"
          value={label}
          onChange={(e): void => setLabel(e.target.value)}
        />
      </label>

      <input
        type="file"
        accept="image/*"
        disabled={busy}
        onChange={(e): void => {
          const f = e.target.files?.[0];
          if (f) void handleFile(f);
        }}
        className="block w-full text-sm"
      />

      {busy && <p className="text-xs text-gray-500">Compressing and saving…</p>}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </main>
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
