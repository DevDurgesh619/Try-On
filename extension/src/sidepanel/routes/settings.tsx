import { useEffect, useState } from 'react';
import { send } from '../messaging';
import { getSettings, updateSettings } from '@/lib/storage';
import type { ReferencePhoto, Settings as SettingsT } from '@/lib/types';
import { Badge } from '../components/ui/Badge';
import { EmptyState } from '../components/ui/EmptyState';

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
    <main className="space-y-6 px-5 py-6">
      <SectionHeader eyebrow="The Library" title="Reference photos." />
      {loading ? (
        <p className="font-mono text-meta uppercase tracking-meta text-mute">Loading · · ·</p>
      ) : photos.length === 0 ? (
        <EmptyState
          eyebrow="Empty"
          title="No photos yet."
          body="Upload one from Onboarding. Up to four reference photos are supported."
        />
      ) : (
        <div className="rounded-card bg-bone border border-rule shadow-card overflow-hidden">
          <ul className="divide-y divide-rule">
            {photos.map((p) => (
              <li key={p.id} className="flex items-center gap-4 px-4 py-3">
                <img src={p.data_url} alt={p.label} className="h-12 w-12 object-cover rounded-sm border border-rule" />
                <div className="flex-1 min-w-0">
                  <div className="font-display text-h2 font-semibold text-ink truncate">{p.label}</div>
                  <div className="font-sans text-caption text-mute mt-0.5">
                    {p.type === 'face' ? 'Face' : 'Full body'}
                  </div>
                </div>
                <button
                  type="button"
                  className="font-sans text-caption text-mute hover:text-accent underline underline-offset-4 decoration-rule hover:decoration-accent transition-colors duration-200"
                  onClick={(): void => void handleDelete(p.id)}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <SectionHeader eyebrow="Behaviour" title="Generation mode." />
      {settings && (
        <div className="rounded-card bg-bone border border-rule shadow-card p-4">
          <button
            type="button"
            onClick={(): void => void togglePlaceholders()}
            className="flex w-full items-start justify-between gap-3 text-left"
          >
            <span className="flex-1 min-w-0">
              <span className="block font-display text-h2 font-semibold text-ink">Use placeholder images</span>
              <span className="block font-sans text-caption text-mute mt-0.5">
                No API calls. Turn off to call the live model and burn credits.
              </span>
            </span>
            <span
              className={[
                'shrink-0 mt-1 relative inline-block h-5 w-9 rounded-pill transition-colors duration-200 ease-editorial',
                settings.use_placeholder_images ? 'bg-accent' : 'bg-rule',
              ].join(' ')}
            >
              <span
                className={[
                  'absolute top-0.5 h-4 w-4 rounded-pill bg-bone shadow-card transition-all duration-200 ease-editorial',
                  settings.use_placeholder_images ? 'left-[18px]' : 'left-0.5',
                ].join(' ')}
              />
            </span>
          </button>
        </div>
      )}

      <SectionHeader eyebrow="A Note" title="Where your photos live." />
      <div className="rounded-card bg-paper-subtle border border-rule p-4">
        <blockquote className="border-l-2 border-accent pl-4 font-display italic text-h2 text-mute">
          Reference photos live in your browser&apos;s local storage. They are sent to the TRY · ON
          backend only as inline data inside a single generation request, then discarded. We do not
          store, log, or share your photos.
        </blockquote>
      </div>
    </main>
  );
}

interface SectionHeaderProps {
  eyebrow: string;
  title: string;
}

function SectionHeader({ eyebrow, title }: SectionHeaderProps): JSX.Element {
  return (
    <div className="space-y-1.5">
      <Badge tone="signal">◆ {eyebrow}</Badge>
      <h2 className="font-display text-display-lg font-semibold text-ink">{title}</h2>
    </div>
  );
}
