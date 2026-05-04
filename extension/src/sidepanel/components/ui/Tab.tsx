import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

interface BottomTabProps {
  to: string;
  active: boolean;
  label: string;
  icon: ReactNode;
}

export function BottomTab({ to, active, label, icon }: BottomTabProps): JSX.Element {
  return (
    <Link
      to={to}
      className={[
        'flex flex-1 flex-col items-center justify-center gap-1 py-2.5 px-2',
        'transition-colors duration-200 ease-editorial',
        active ? 'text-accent' : 'text-mute hover:text-ink',
      ].join(' ')}
    >
      <span
        className={[
          'flex h-8 w-12 items-center justify-center rounded-pill transition-colors duration-200 ease-editorial',
          active ? 'bg-accent-tint' : 'bg-transparent',
        ].join(' ')}
      >
        {icon}
      </span>
      <span className="font-sans text-[10px] font-semibold tracking-cta">{label}</span>
    </Link>
  );
}

// Keep old name as alias so existing imports don't break — preferred new usage is BottomTab.
export const Tab = BottomTab;
