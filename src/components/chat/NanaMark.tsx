import { cn } from '../ui';
import logo from '../../assets/nana.svg';

interface NanaMarkProps {
  size?: number;
  className?: string;
}

/** The assistant identity mark. Never used as generic page chrome. */
export function NanaMark({ size = 20, className }: NanaMarkProps) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-[6px] border border-line bg-surface-sunken',
        className,
      )}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <img
        src={logo}
        alt=""
        draggable={false}
        className="object-contain"
        style={{ width: Math.max(14, size - 4), height: Math.max(14, size - 4) }}
      />
    </span>
  );
}
