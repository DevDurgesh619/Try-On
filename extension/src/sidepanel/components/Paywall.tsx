import { useState } from 'react';
import { Link } from 'react-router-dom';
import { send } from '../messaging';
import { Button } from './ui/Button';
import { Badge } from './ui/Badge';
import { TextField } from './ui/TextField';
import { humanizeError } from './ui/errors';
import { useToast } from './ui/Toast';
import type { ErrorResponse } from '@/lib/types';

export function Paywall({ signedIn }: { signedIn: boolean }): JSX.Element {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const toast = useToast();

  async function joinWaitlist(): Promise<void> {
    setSubmitting(true);
    setErrMsg(null);
    const r = await send({ type: 'JOIN_WAITLIST', email });
    setSubmitting(false);
    if (r.ok) {
      setDone(true);
    } else {
      const code = (r as ErrorResponse).code;
      const human = humanizeError(code, r.message);
      setErrMsg(human);
    }
  }

  async function onSignIn(): Promise<void> {
    setSubmitting(true);
    setErrMsg(null);
    const r = await send({ type: 'SIGN_IN' });
    setSubmitting(false);
    if (!r.ok) {
      const code = (r as ErrorResponse).code;
      const human = humanizeError(code, r.message);
      setErrMsg(human);
      toast.show(human, 'signal');
    }
  }

  if (!signedIn) {
    return (
      <main className="px-5 py-10 space-y-6 max-w-[480px]">
        <header className="space-y-3">
          <Badge tone="signal">◆ The Paywall</Badge>
          <h2 className="font-display text-display-xl font-semibold text-ink">
            Five becomes <span className="italic text-accent">ten.</span>
          </h2>
          <p className="font-display italic text-h2 text-mute">
            Sign in for five more, on the house.
          </p>
        </header>
        <p className="font-sans text-caption text-mute">
          No password. No email step. One click.
        </p>
        <Button variant="primary" size="md" fullWidth loading={submitting} onClick={(): void => void onSignIn()}>
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
            <path d="M21.6 12.2c0-.7-.06-1.4-.18-2H12v3.8h5.4c-.24 1.3-.94 2.4-2 3.1v2.6h3.24c1.9-1.74 2.96-4.3 2.96-7.5z" />
            <path d="M12 22c2.7 0 5-.9 6.64-2.42l-3.24-2.6c-.9.6-2.04.96-3.4.96-2.6 0-4.8-1.76-5.6-4.12H3.06v2.6C4.7 19.6 8.06 22 12 22z" />
            <path d="M6.4 13.82c-.2-.6-.32-1.24-.32-1.92s.12-1.32.32-1.92V7.38H3.06C2.4 8.74 2 10.32 2 12s.4 3.26 1.06 4.62l3.34-2.8z" />
            <path d="M12 6.04c1.46 0 2.78.5 3.82 1.5l2.86-2.86C17 3.06 14.7 2 12 2 8.06 2 4.7 4.4 3.06 7.38L6.4 9.98c.8-2.36 3-4.12 5.6-4.12z" />
          </svg>
          Sign in with Google
        </Button>
        {errMsg && (
          <p className="font-sans text-caption text-accent border-l-2 border-accent pl-3">
            {errMsg}
          </p>
        )}
        <p className="font-sans text-caption text-mute pt-4 border-t border-rule">
          Your photos never leave your device — only the single image you are trying on is sent to
          the model.{' '}
          <Link
            to="/"
            className="font-semibold text-accent underline underline-offset-4 decoration-accent-ring hover:decoration-accent"
          >
            Go back
          </Link>
        </p>
      </main>
    );
  }

  if (done) {
    return (
      <main className="px-5 py-10 space-y-5 max-w-[480px]">
        <header className="space-y-3">
          <Badge tone="signal">◆ The Waitlist</Badge>
          <h2 className="font-display text-display-xl font-semibold text-ink">
            On the <span className="italic text-accent">list.</span>
          </h2>
          <p className="font-display italic text-h2 text-mute">
            We will write when paid plans land.
          </p>
        </header>
        <p className="font-sans text-caption text-mute pt-4 border-t border-rule">
          Until then, fresh try-ons resume tomorrow at UTC midnight if you have daily budget left.
        </p>
        <Link to="/">
          <span className="inline-flex items-center gap-2 rounded-pill bg-accent-tint text-accent font-sans text-[11px] font-semibold tracking-cta px-4 py-2 hover:bg-accent hover:text-bone transition-colors duration-200 ease-editorial">
            Back to TRY · ON
          </span>
        </Link>
      </main>
    );
  }

  return (
    <main className="px-5 py-10 space-y-6 max-w-[480px]">
      <header className="space-y-3">
        <Badge tone="signal">◆ The Paywall</Badge>
        <h2 className="font-display text-display-xl font-semibold text-ink">
          What happens <span className="italic text-accent">next.</span>
        </h2>
        <p className="font-display italic text-h2 text-mute">
          Paid plans are coming. Drop your email — bonus credits at launch.
        </p>
      </header>
      <div className="space-y-4">
        <TextField
          label="Email"
          type="email"
          value={email}
          onChange={(e): void => setEmail(e.target.value)}
          placeholder="you@example.com"
          autoFocus
        />
        <Button
          variant="primary"
          size="md"
          fullWidth
          loading={submitting}
          disabled={email.length === 0}
          onClick={(): void => void joinWaitlist()}
        >
          Notify me
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className="h-4 w-4" strokeLinecap="round" strokeLinejoin="round">
            <line x1="5" y1="12" x2="19" y2="12" />
            <polyline points="12 5 19 12 12 19" />
          </svg>
        </Button>
        {errMsg && (
          <p className="font-sans text-caption text-accent border-l-2 border-accent pl-3">
            {errMsg}
          </p>
        )}
      </div>
      <p className="font-sans text-caption text-mute pt-4 border-t border-rule">
        <Link
          to="/"
          className="font-semibold text-accent underline underline-offset-4 decoration-accent-ring hover:decoration-accent"
        >
          Back to TRY · ON
        </Link>
      </p>
    </main>
  );
}
