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
        'inline-flex shrink-0 items-center justify-center rounded-[5px] border border-line bg-surface-sunken',
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
        style={{ width: Math.max(12, size - 6), height: Math.max(12, size - 6) }}
      />
    </span>
  );
}
