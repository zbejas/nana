import { useEffect, useState } from 'react';
import { useInstallPrompt } from './useInstallPrompt';
import { Button, Dialog } from '../ui';
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
    <Dialog
      open
      onClose={() => setDismissed(true)}
      eyebrow="Mobile app"
      title={shouldShowManualHint ? 'Add Nana to your home screen' : 'Install Nana'}
      description={
        shouldShowManualHint
          ? 'Nana runs like an app once it is on your home screen: full-screen, faster, and one tap away.'
          : 'A full-screen, faster version of Nana with its own icon.'
      }
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={dismissBanner}>
            {shouldShowManualHint ? 'Not now' : "Don't remind me"}
          </Button>
          {shouldShowManualHint ? (
            <Button variant="primary" onClick={() => setDismissed(true)}>
              Got it
            </Button>
          ) : (
            <Button variant="primary" onClick={() => void promptInstall()}>
              Install Nana
            </Button>
          )}
        </>
      }
    >
      <div className="flex items-center gap-4 rounded-control border border-line bg-surface-sunken/50 p-4">
        <img src={logo} alt="" className="h-12 w-12 shrink-0" />
        <p className="text-sm leading-relaxed text-ink-secondary">
          {shouldShowManualHint
            ? 'Tap the Share button in Safari, then choose “Add to Home Screen”.'
            : 'Use the install button below, or your browser menu, to place Nana on your home screen.'}
        </p>
      </div>
    </Dialog>
  );
}
