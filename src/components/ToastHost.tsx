import { createPortal } from 'react-dom';
import { Toast } from './Toast';
import { useToasts } from '../state/hooks';
import type { ToastType } from '../state/atoms';

const TOAST_DURATION_MS: Record<ToastType, number> = {
  success: 2000,
  info: 3000,
  error: 5000,
};

export function ToastHost() {
  const { toasts, removeToast } = useToasts();

  if (typeof window === 'undefined' || !window.document?.body || toasts.length === 0) {
    return null;
  }

  return createPortal(
    <div className="fixed right-4 top-4 z-[10003] flex w-[min(92vw,24rem)] flex-col gap-2 md:right-5 md:top-5">
      {toasts.map((toast) => (
        <Toast
          key={toast.id}
          message={toast.message}
          type={toast.type}
          durationMs={TOAST_DURATION_MS[toast.type]}
          onClose={() => removeToast(toast.id)}
        />
      ))}
    </div>,
    window.document.body
  );
}
