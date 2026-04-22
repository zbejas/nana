import { ChevronUpDownIcon } from '@heroicons/react/24/outline';
import type { SelectHTMLAttributes } from 'react';

type SettingsSelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  containerClassName?: string;
};

function joinClasses(...classes: Array<string | undefined>) {
  return classes.filter(Boolean).join(' ');
}

const baseSelectClassName =
  'w-full appearance-none rounded-lg border border-white/20 bg-black/30 px-4 py-2.5 pr-11 text-sm text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] transition-all hover:border-white/30 hover:bg-black/40 focus:border-white/30 focus:bg-black/40 focus:outline-none focus:ring-2 focus:ring-white/20 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-black/20 disabled:text-gray-400 [&>option]:bg-[#111111] [&>option]:text-white';

export function SettingsSelect({ containerClassName, className, children, ...props }: SettingsSelectProps) {
  return (
    <div className={joinClasses('relative', containerClassName)}>
      <select {...props} className={joinClasses(baseSelectClassName, className)}>
        {children}
      </select>
      <span
        className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-gray-400"
        aria-hidden="true"
      >
        <ChevronUpDownIcon className="h-4 w-4" />
      </span>
    </div>
  );
}