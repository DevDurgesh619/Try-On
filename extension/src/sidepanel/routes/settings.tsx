import { useEffect, useState } from 'react';
import { send } from '../messaging';
import { getSettings, updateSettings } from '@/lib/storage';
import type { ReferencePhoto, Settings as SettingsT } from '@/lib/types';

export function Settings(): JSX.Element {
  const [photos, setPhotos] = useState<ReferencePhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<SettingsT | null>(null);

  async function refresh(): Promise<void> {
    const r = await send({ type: 'LIST_PHOTOS' });
    if (r.ok && 'photos' in r) setPhotos(r.photos);
    setSettings(await getSettings());
    setLoading(false);
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function handleDelete(id: string): Promise<void> {
    await send({ type: 'DELETE_PHOTO', id });
    await refresh();
  }

  async function togglePlaceholders(): Promise<void> {
    if (!settings) return;
    const next = await updateSettings({ use_placeholder_images: !settings.use_placeholder_images });
    setSettings(next);
  }

  return (
    <main className="space-y-6 p-4">
      <section>
        <h2 className="text-base font-semibold">Reference photos</h2>
        {loading ? (
          <p className="mt-2 text-xs text-gray-500">Loading…</p>
        ) : photos.length === 0 ? (
          <p className="mt-2 text-xs text-gray-500">No photos yet.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {photos.map((p) => (
              <li key={p.id} className="flex items-center gap-3 rounded border border-gray-200 p-2">
                <img src={p.data_url} alt={p.label} className="h-12 w-12 rounded object-cover" />
                <div className="flex-1">
                  <div className="text-sm font-medium">{p.label}</div>
                  <div className="text-xs text-gray-500">{p.type}</div>
                </div>
                <button
                  className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
                  onClick={(): void => void handleDelete(p.id)}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-base font-semibold">Generation</h2>
        {settings && (
          <label className="mt-2 flex items-start gap-2 text-xs text-gray-700">
            <input
              type="checkbox"
              checked={settings.use_placeholder_images}
              onChange={(): void => void togglePlaceholders()}
              className="mt-0.5"
            />
            <span>
              Use placeholder images (no API calls). Turn off to call the live model and burn
              credits.
            </span>
          </label>
        )}
      </section>

      <section>
        <h2 className="text-base font-semibold">Privacy</h2>
        <p className="mt-1 text-xs text-gray-600">
          Reference photos live in your browser&apos;s local storage. They are sent to the TryOn
          backend only as inline data inside a single generation request, then discarded. We do not
          store, log, or share your photos.
        </p>
      </section>
    </main>
  );
}
