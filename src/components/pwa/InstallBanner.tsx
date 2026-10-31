import { useEffect, useState } from 'react';
import { useInstallPrompt } from './useInstallPrompt';
import { Button, IconButton } from '../ui';
import { XMarkIcon } from '@heroicons/react/20/solid';
import logo from '../../assets/nana.svg';

const INSTALL_DISMISSED_KEY = 'pwa-install-dismissed';

interface NavigatorWithStandalone extends Navigator {
  standalone?: boolean;
}

function isStandaloneMode(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches
    || window.matchMedia('(display-mode: fullscreen)').matches
    || window.matchMedia('(display-mode: minimal-ui)').matches
    || (navigator as NavigatorWithStandalone).standalone === true
  );
}

function isIosMobile(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function isMobileDevice(): boolean {
  return window.matchMedia('(max-width: 767px)').matches || /android|iphone|ipad|ipod/i.test(navigator.userAgent);
}

export function InstallBanner() {
  const { canInstall, promptInstall } = useInstallPrompt();
  const [dismissed, setDismissed] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [ios, setIos] = useState(false);
  const [readyToShow, setReadyToShow] = useState(false);

  useEffect(() => {
    setMobile(isMobileDevice());
    setInstalled(isStandaloneMode());
    setIos(isIosMobile());
    setDismissed(localStorage.getItem(INSTALL_DISMISSED_KEY) === 'true');

    const handleAppInstalled = () => setInstalled(true);
    window.addEventListener('appinstalled', handleAppInstalled);

    const showModal = () => window.setTimeout(() => setReadyToShow(true), 120);

    if (document.readyState === 'complete') {
      showModal();
      return () => window.removeEventListener('appinstalled', handleAppInstalled);
    }

    window.addEventListener('load', showModal, { once: true });
    return () => {
      window.removeEventListener('load', showModal);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const dismissBanner = () => {
    localStorage.setItem(INSTALL_DISMISSED_KEY, 'true');
    setDismissed(true);
  };

  if (!readyToShow || !mobile || installed || dismissed) {
    return null;
  }

  if (!ios && !canInstall) {
    return null;
  }

  const shouldShowManualHint = ios;

  return (
    <aside
      role="region"
      aria-label={shouldShowManualHint ? 'Add Nana to your home screen' : 'Install Nana'}
      className="fixed inset-x-3 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-[900] mx-auto max-w-md animate-banner-in overflow-hidden rounded-panel border border-line bg-surface p-4 text-ink shadow-float"
    >
      <div className="flex items-start gap-3">
        <img src={logo} alt="" className="h-10 w-10 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-semibold tracking-[-0.01em] text-ink">
            {shouldShowManualHint ? 'Add Nana to your home screen' : 'Install Nana'}
          </p>
          <p className="mt-1 text-[12px] leading-relaxed text-ink-secondary">
            {shouldShowManualHint
              ? 'Tap Share in Safari, then choose “Add to Home Screen”. Nana runs full-screen and one tap away.'
              : 'A full-screen, faster version with its own icon. Use the button below or your browser menu.'}
          </p>
        </div>
        <IconButton
          label="Close install prompt"
          size="md"
          onClick={() => setDismissed(true)}
          className="-mr-1 -mt-1"
        >
          <XMarkIcon />
        </IconButton>
      </div>
      <div className="mt-3 flex items-center justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={dismissBanner}>
          {shouldShowManualHint ? 'Not now' : "Don't remind me"}
        </Button>
        {shouldShowManualHint ? (
          <Button variant="primary" size="sm" onClick={() => setDismissed(true)}>
            Got it
          </Button>
        ) : (
          <Button variant="primary" size="sm" onClick={() => void promptInstall()}>
            Install Nana
          </Button>
        )}
      </div>
    </aside>
  );
}
