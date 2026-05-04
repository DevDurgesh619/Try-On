import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'link';
type Size = 'sm' | 'md';

interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  fullWidth?: boolean;
  children: ReactNode;
}

const base =
  'inline-flex items-center justify-center gap-2 font-sans font-semibold transition-all duration-200 ease-editorial disabled:cursor-not-allowed select-none';

const variantClasses: Record<Variant, string> = {
  primary:
    'bg-cta-gradient text-bone shadow-cta hover:shadow-cta-lg hover:scale-[1.015] active:scale-[0.99] disabled:bg-none disabled:bg-rule disabled:text-mute-soft disabled:shadow-none disabled:hover:scale-100 rounded-pill',
  secondary:
    'bg-bone text-accent border border-accent-ring hover:bg-accent-tint hover:border-accent disabled:text-mute-soft disabled:border-rule rounded-pill',
  ghost:
    'bg-transparent text-accent hover:bg-accent-tint disabled:text-mute-soft rounded-card',
  link:
    'bg-transparent text-accent normal-case underline underline-offset-4 decoration-accent-ring hover:decoration-accent disabled:text-mute-soft',
};

const sizeClasses: Record<Size, string> = {
  sm: 'text-[11px] px-3 py-1.5',
  md: 'text-[13px] px-5 py-3',
};

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  fullWidth = false,
  disabled,
  className = '',
  children,
  ...rest
}: ButtonProps): JSX.Element {
  const widthClass = fullWidth ? 'w-full' : '';
  return (
    <button
      type={rest.type ?? 'button'}
      disabled={disabled || loading}
      className={[base, variantClasses[variant], sizeClasses[size], widthClass, className]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    >
      {loading ? <span className="font-mono tracking-meta">· · ·</span> : children}
    </button>
  );
}
