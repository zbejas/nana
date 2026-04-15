import { useEffect, useState } from 'react';
import { ConfirmDialog } from '../modals/ConfirmDialog';
import { useInstallPrompt } from './useInstallPrompt';

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

    const handleAppInstalled = () => {
      setInstalled(true);
    };

    window.addEventListener('appinstalled', handleAppInstalled);

    const showModal = () => {
      window.setTimeout(() => setReadyToShow(true), 120);
    };

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

  const handleInstallClick = async () => {
    await promptInstall();
  };

  if (!readyToShow || !mobile || installed || dismissed) {
    return null;
  }

  if (!ios && !canInstall) {
    return null;
  }

  const shouldShowManualHint = ios;
  const title = shouldShowManualHint ? 'Install Nana Manually' : 'Install Nana';
  const baseMessage = shouldShowManualHint
    ? ios
      ? 'To install this app on iOS Safari, tap Share and choose "Add to Home Screen".'
      : 'To install this app, open your browser menu and choose "Add to Home Screen".'
    : 'Install the app for a faster, full-screen mobile experience.';
  const message = baseMessage;

  return (
    <ConfirmDialog
      isOpen={true}
      title={title}
      message={message}
      onSave={handleInstallClick}
      onDiscard={dismissBanner}
      onCancel={() => setDismissed(true)}
      saveLabel={shouldShowManualHint ? '' : 'Install'}
      discardLabel="Don't remind me"
      cancelLabel="Close"
    />
  );
}
