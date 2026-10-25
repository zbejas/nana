import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CheckCircleIcon,
  ExclamationCircleIcon,
  InformationCircleIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';

interface ToastProps {
  message: string;
  type?: 'error' | 'success' | 'info';
  onClose: () => void;
  durationMs?: number;
}

const tones = {
  error: {
    icon: ExclamationCircleIcon,
    iconClass: 'text-danger',
    label: 'Error',
  },
  success: {
    icon: CheckCircleIcon,
    iconClass: 'text-success',
    label: 'Success',
  },
  info: {
    icon: InformationCircleIcon,
    iconClass: 'text-signal',
    label: 'Notice',
  },
};

export function Toast({ message, type = 'error', onClose, durationMs = 3000 }: ToastProps) {
  const [isExiting, setIsExiting] = useState(false);
  const closingRef = useRef(false);

  const closeToast = useCallback(() => {
    if (closingRef.current) return;

    closingRef.current = true;
    setIsExiting(true);

    window.setTimeout(() => {
      onClose();
    }, 180);
  }, [onClose]);

  useEffect(() => {
    if (durationMs <= 0) return;

    const timer = window.setTimeout(() => {
      closeToast();
    }, durationMs);

    return () => window.clearTimeout(timer);
  }, [durationMs, closeToast]);

  const tone = tones[type];
  const Icon = tone.icon;

  return (
    <div
      role={type === 'error' ? 'alert' : 'status'}
      aria-live={type === 'error' ? 'assertive' : 'polite'}
      className={`w-full max-w-sm transform transition-all duration-200 ease-out ${
        isExiting ? 'translate-x-3 scale-[0.98] opacity-0' : 'translate-x-0 scale-100 opacity-100'
      }`}
    >
      <div className="relative overflow-hidden rounded-panel border border-line bg-surface-raised shadow-float">
        <div className="flex items-start gap-3 px-4 py-3.5">
          <span className={`mt-0.5 shrink-0 ${tone.iconClass}`}>
            <Icon className="h-[1.15rem] w-[1.15rem]" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[13.5px] leading-snug text-ink">{message}</p>
          </div>
          <button
            onClick={closeToast}
            className="rounded-[5px] p-1 text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink"
            aria-label="Dismiss notification"
          >
            <XMarkIcon className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
