import { useAtomValue, useSetAtom } from 'jotai';
import { removeToastAtom, showToastAtom, toastsAtom, type ToastType } from '../atoms';

export function useToasts() {
    const toasts = useAtomValue(toastsAtom);
    const showToast = useSetAtom(showToastAtom);
    const removeToast = useSetAtom(removeToastAtom);

    return {
        toasts,
        showToast: (message: string, type: ToastType = 'info') => showToast({ message, type }),
        removeToast,
    };
}
