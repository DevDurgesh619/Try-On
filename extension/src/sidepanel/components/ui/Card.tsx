import type { HTMLAttributes, ReactNode } from 'react';

type Variant = 'plain' | 'rule' | 'inset';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: Variant;
  active?: boolean;
  children: ReactNode;
}

const variantClasses: Record<Variant, string> = {
  plain: 'bg-bone border border-rule rounded-card shadow-card',
  rule: 'bg-bone border border-rule rounded-card',
  inset: 'bg-paper-subtle border border-rule rounded-card',
};

export function Card({
  variant = 'plain',
  active = false,
  className = '',
  children,
  ...rest
}: CardProps): JSX.Element {
  const activeClass = active
    ? 'bg-accent-tint border-accent-ring shadow-card-lg'
    : '';
  return (
    <div
      className={[
        'transition-all duration-200 ease-editorial',
        variantClasses[variant],
        activeClass,
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    >
      {children}
    </div>
  );
}
