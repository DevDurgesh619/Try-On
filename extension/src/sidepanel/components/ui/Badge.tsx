import type { ReactNode } from 'react';

type Tone = 'neutral' | 'mute' | 'signal';

interface BadgeProps {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}

const toneClasses: Record<Tone, string> = {
  neutral: 'bg-paper-subtle text-ink',
  mute: 'bg-paper-subtle text-mute',
  signal: 'bg-accent-tint text-accent',
};

export function Badge({ tone = 'neutral', children, className = '' }: BadgeProps): JSX.Element {
  return (
    <span
      className={[
        'inline-flex items-center gap-1 rounded-pill px-2.5 py-1',
        'font-sans text-[10.5px] font-semibold tracking-cta',
        toneClasses[tone],
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </span>
  );
}
