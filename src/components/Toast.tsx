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
    accent: 'bg-danger',
    iconClass: 'border-danger/25 bg-danger-soft text-danger',
    label: 'Error',
  },
  success: {
    icon: CheckCircleIcon,
    accent: 'bg-success',
    iconClass: 'border-success/25 bg-success-soft text-success',
    label: 'Success',
  },
  info: {
    icon: InformationCircleIcon,
    accent: 'bg-signal',
    iconClass: 'border-signal/25 bg-signal-soft text-signal',
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
        <span className={`absolute left-0 top-0 h-full w-[3px] ${tone.accent}`} aria-hidden="true" />
        <div className="flex items-start gap-3 px-4 py-3 pl-5">
          <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border ${tone.iconClass}`}>
            <Icon className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-ink-muted">{tone.label}</p>
            <p className="mt-0.5 text-[13px] leading-snug text-ink">{message}</p>
          </div>
          <button
            onClick={closeToast}
            className="rounded-[6px] p-1 text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink"
            aria-label="Dismiss notification"
          >
            <XMarkIcon className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
