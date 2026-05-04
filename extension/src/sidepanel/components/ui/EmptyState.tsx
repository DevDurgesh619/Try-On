import type { ReactNode } from 'react';

interface EmptyStateProps {
  eyebrow?: string;
  title: string;
  body?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({
  eyebrow,
  title,
  body,
  action,
  className = '',
}: EmptyStateProps): JSX.Element {
  return (
    <div className={['py-12 px-2 text-center', className].filter(Boolean).join(' ')}>
      <div
        className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-pill bg-tint-gradient"
        aria-hidden="true"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-7 w-7 text-accent">
          <circle cx="12" cy="12" r="9" />
          <path d="M9 12l2 2 4-4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      {eyebrow ? (
        <p className="font-sans text-[10.5px] font-semibold uppercase tracking-cta text-accent mb-2">
          {eyebrow}
        </p>
      ) : null}
      <h2 className="font-display text-display text-ink mb-2">{title}</h2>
      {body ? <div className="text-body text-mute max-w-[440px] mx-auto">{body}</div> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
