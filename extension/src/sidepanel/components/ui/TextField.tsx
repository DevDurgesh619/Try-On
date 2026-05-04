import type { InputHTMLAttributes } from 'react';

interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label?: string;
  error?: string;
}

export function TextField({
  label,
  error,
  className = '',
  ...rest
}: TextFieldProps): JSX.Element {
  return (
    <label className="block">
      {label ? (
        <span className="block font-sans text-caption font-medium text-mute mb-2">
          {label}
        </span>
      ) : null}
      <input
        {...rest}
        className={[
          'w-full bg-bone border border-rule rounded-pill px-4 py-2.5',
          'font-sans text-body text-ink placeholder:text-mute-soft',
          'focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent-ring/40 transition-all duration-200 ease-editorial',
          className,
        ]
          .filter(Boolean)
          .join(' ')}
      />
      {error ? (
        <span className="block mt-2 text-caption text-accent">{error}</span>
      ) : null}
    </label>
  );
}
