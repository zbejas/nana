import { BoltIcon } from '@heroicons/react/24/solid';
import { BoltIcon as BoltIconOutline } from '@heroicons/react/24/outline';
import { setLowPowerMode, useLowPowerMode } from '../lib/settings';

export function AuthFooter() {
  const lowPower = useLowPowerMode();

  return (
    <div className="fixed bottom-4 inset-x-0 flex justify-center pointer-events-none z-50">
      <button
        onClick={() => setLowPowerMode(!lowPower)}
        title={lowPower ? 'Low power mode — click for normal' : 'Normal mode — click for low power'}
        aria-label={lowPower ? 'Switch to normal mode' : 'Switch to low power mode'}
        className="pointer-events-auto p-2.5 rounded-full bg-white/[0.04] hover:bg-white/10 border border-white/[0.07] hover:border-white/20 transition-all duration-200 group"
      >
        {lowPower ? (
          <BoltIconOutline className="w-4 h-4 text-white/25 group-hover:text-white/60 transition-colors duration-200" />
        ) : (
          <BoltIcon className="w-4 h-4 text-amber-400/50 group-hover:text-amber-400/80 transition-colors duration-200" />
        )}
      </button>
    </div>
  );
}
