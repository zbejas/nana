import { useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

interface WindowWithInstallPromptFlag extends Window {
    __nanaInstallPromptListenerAttached?: boolean;
}

function isMobileDevice(): boolean {
    return window.matchMedia('(max-width: 767px)').matches || /android|iphone|ipad|ipod/i.test(navigator.userAgent);
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;
const promptSubscribers = new Set<(prompt: BeforeInstallPromptEvent | null) => void>();

function notifyPromptSubscribers() {
    promptSubscribers.forEach((subscriber) => subscriber(deferredPrompt));
}

function ensureInstallPromptListener() {
    if (typeof window === 'undefined') {
        return;
    }

    const windowWithFlag = window as WindowWithInstallPromptFlag;
    if (windowWithFlag.__nanaInstallPromptListenerAttached) {
        return;
    }

    window.addEventListener('beforeinstallprompt', (event: Event) => {
        if (!isMobileDevice()) {
            return;
        }

        const beforeInstallPromptEvent = event as BeforeInstallPromptEvent;
        beforeInstallPromptEvent.preventDefault();
        deferredPrompt = beforeInstallPromptEvent;
        notifyPromptSubscribers();
    });

    window.addEventListener('appinstalled', () => {
        deferredPrompt = null;
        notifyPromptSubscribers();
    });

    windowWithFlag.__nanaInstallPromptListenerAttached = true;
}

ensureInstallPromptListener();

export function useInstallPrompt() {
    const [availablePrompt, setAvailablePrompt] = useState<BeforeInstallPromptEvent | null>(deferredPrompt);

    useEffect(() => {
        ensureInstallPromptListener();

        const subscriber = (prompt: BeforeInstallPromptEvent | null) => {
            setAvailablePrompt(prompt);
        };

        promptSubscribers.add(subscriber);
        return () => {
            promptSubscribers.delete(subscriber);
        };
    }, []);

    const promptInstall = async () => {
        if (!deferredPrompt) {
            return undefined;
        }

        await deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        deferredPrompt = null;
        notifyPromptSubscribers();
        return outcome;
    };

    return {
        canInstall: availablePrompt !== null,
        promptInstall,
    };
}
