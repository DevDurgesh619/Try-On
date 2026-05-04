import { Button } from './ui/Button';

interface ResultViewerProps {
  imageUrl: string;
  msTaken: number;
  generationId: string;
  sequence: number;
  onDownload: () => void;
  onRegenerate: () => void;
  onStartOver: () => void;
}

export function ResultViewer({
  imageUrl,
  msTaken,
  generationId,
  sequence,
  onDownload,
  onRegenerate,
  onStartOver,
}: ResultViewerProps): JSX.Element {
  const seq = String(sequence).padStart(2, '0');
  const tail = generationId.slice(-3).toUpperCase();
  const seconds = (msTaken / 1000).toFixed(1);

  return (
    <div className="space-y-4">
      <div className="rounded-card overflow-hidden bg-bone border border-rule shadow-card">
        <img
          src={imageUrl}
          alt="Try-on result"
          className="block w-full animate-reveal-blur"
        />
      </div>

      <div className="flex items-center justify-between gap-3">
        <span className="inline-flex items-center gap-2 rounded-pill bg-accent-tint text-accent font-mono text-meta tracking-meta font-semibold px-2.5 py-1">
          TRY-ON №{seq} · {tail}
        </span>
        <span
          className="font-display italic text-caption text-mute"
          style={{ animation: 'fade-rise 200ms cubic-bezier(0.2, 0.6, 0.2, 1) both', animationDelay: '320ms' }}
        >
          Generated in {seconds}s · approx ₹4–6
        </span>
      </div>

      <div
        className="space-y-3"
        style={{ animation: 'fade-rise 200ms cubic-bezier(0.2, 0.6, 0.2, 1) both', animationDelay: '200ms' }}
      >
        <Button variant="primary" size="md" fullWidth onClick={onDownload}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          Download
        </Button>
        <div className="flex items-center justify-center gap-2">
          <Button variant="ghost" size="sm" onClick={onRegenerate}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3.5 w-3.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
            Regenerate
          </Button>
          <span className="text-mute-soft">·</span>
          <Button variant="ghost" size="sm" onClick={onStartOver}>
            Start over
          </Button>
        </div>
      </div>
    </div>
  );
}

interface ResultSkeletonProps {
  helper?: string;
}

export function ResultSkeleton({
  helper = 'Usually 8–15 seconds. Held to one request at a time.',
}: ResultSkeletonProps): JSX.Element {
  return (
    <div className="space-y-3">
      <div className="rounded-card h-72 bg-tint-gradient border border-rule flex items-center justify-center">
        <span className="font-display italic text-accent font-semibold animate-pulse-soft text-[14px] tracking-[0.3em] uppercase">
          G&nbsp;e&nbsp;n&nbsp;e&nbsp;r&nbsp;a&nbsp;t&nbsp;i&nbsp;n&nbsp;g
        </span>
      </div>
      <p className="font-sans text-caption text-mute italic text-center">{helper}</p>
    </div>
  );
}
