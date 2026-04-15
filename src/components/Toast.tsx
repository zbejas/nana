import { useCallback, useEffect, useRef, useState } from 'react';

interface ToastProps {
  message: string;
  type?: 'error' | 'success' | 'info';
  onClose: () => void;
  durationMs?: number;
}

export function Toast({ message, type = 'error', onClose, durationMs = 3000 }: ToastProps) {
  const [isExiting, setIsExiting] = useState(false);
  const closingRef = useRef(false);

  const closeToast = useCallback(() => {
    if (closingRef.current) {
      return;
    }

    closingRef.current = true;
    setIsExiting(true);

    window.setTimeout(() => {
      onClose();
    }, 180);
  }, [onClose]);

  useEffect(() => {
    if (durationMs <= 0) {
      return;
    }

    const timer = window.setTimeout(() => {
      closeToast();
    }, durationMs);

    return () => window.clearTimeout(timer);
  }, [durationMs, closeToast]);

  const iconColor = {
    error: 'text-red-400 light:text-red-600',
    success: 'text-emerald-400 light:text-emerald-600',
    info: 'text-sky-400 light:text-sky-600',
  }[type];

  const accentColor = {
    error: 'bg-red-400/80 light:bg-red-500/85',
    success: 'bg-emerald-400/80 light:bg-emerald-500/85',
    info: 'bg-sky-400/80 light:bg-sky-500/85',
  }[type];

  const icon = {
    error: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    success: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    info: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  }[type];

  return (
    <div
      role={type === 'error' ? 'alert' : 'status'}
      aria-live={type === 'error' ? 'assertive' : 'polite'}
      className={`w-full max-w-sm transform transition-all duration-200 ease-out ${
        isExiting
          ? 'translate-x-3 opacity-0 scale-[0.98]'
          : 'translate-x-0 opacity-100 scale-100'
      }`}
    >
      <div className="relative overflow-hidden rounded-xl border border-white/10 bg-black/75 backdrop-blur-md shadow-lg light:border-gray-200/80 light:bg-white/95">
        <span className={`absolute left-0 top-0 h-full w-1 ${accentColor}`} aria-hidden="true" />
        <div className="flex items-start gap-3 px-4 py-3">
          <span className={`shrink-0 ${iconColor}`}>{icon}</span>
          <span className="flex-1 text-sm font-medium text-gray-100 light:text-gray-800">{message}</span>
          <button
            onClick={closeToast}
            className="rounded-md p-1 text-gray-300 transition-colors hover:bg-white/10 hover:text-white light:text-gray-500 light:hover:bg-gray-100 light:hover:text-gray-700"
            aria-label="Dismiss notification"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
