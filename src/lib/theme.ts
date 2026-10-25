import React from 'react';
import { createLogger } from './logger';

const log = createLogger('Theme');

export type ThemePreference = 'system' | 'dark' | 'light';
export type ResolvedTheme = 'dark' | 'light';

const STORAGE_KEY = 'nana-theme';
const CHANGE_EVENT = 'nana-theme-change';

function isPreference(value: string | null): value is ThemePreference {
  return value === 'system' || value === 'dark' || value === 'light';
}

export function getThemePreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isPreference(stored)) {
      return stored;
    }
  } catch (error) {
    log.error('Failed to read theme preference', error);
  }

  return 'dark';
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference === 'light') {
    return 'light';
  }

  if (preference === 'dark') {
    return 'dark';
  }

  if (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: light)').matches) {
    return 'light';
  }

  return 'dark';
}

export function applyTheme(preference: ThemePreference = getThemePreference()): ResolvedTheme {
  const resolved = resolveTheme(preference);
  const root = document.documentElement;

  root.dataset.theme = resolved;
  root.style.colorScheme = resolved;

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute('content', resolved === 'light' ? '#faf9f7' : '#0c0c0d');
  }

  return resolved;
}

export function setThemePreference(preference: ThemePreference): void {
  try {
    localStorage.setItem(STORAGE_KEY, preference);
    applyTheme(preference);
    window.dispatchEvent(new CustomEvent<ThemePreference>(CHANGE_EVENT, { detail: preference }));
  } catch (error) {
    log.error('Failed to save theme preference', error);
  }
}

export function initTheme(): void {
  applyTheme();

  const media = window.matchMedia('(prefers-color-scheme: light)');
  const handleChange = () => {
    if (getThemePreference() === 'system') {
      applyTheme('system');
    }
  };

  media.addEventListener('change', handleChange);

  window.addEventListener('storage', (event) => {
    if (event.key === STORAGE_KEY) {
      applyTheme();
    }
  });
}

export function useTheme() {
  const [preference, setPreference] = React.useState<ThemePreference>(() => getThemePreference());
  const [resolved, setResolved] = React.useState<ResolvedTheme>(() => resolveTheme(preference));

  React.useEffect(() => {
    const update = () => {
      const next = getThemePreference();
      setPreference(next);
      setResolved(resolveTheme(next));
      applyTheme(next);
    };

    const handleThemeChange = () => update();
    const handleStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) {
        update();
      }
    };
    const media = window.matchMedia('(prefers-color-scheme: light)');

    window.addEventListener(CHANGE_EVENT, handleThemeChange);
    window.addEventListener('storage', handleStorage);
    media.addEventListener('change', update);

    return () => {
      window.removeEventListener(CHANGE_EVENT, handleThemeChange);
      window.removeEventListener('storage', handleStorage);
      media.removeEventListener('change', update);
    };
  }, []);

  const setTheme = React.useCallback((next: ThemePreference) => {
    setThemePreference(next);
    setPreference(next);
    setResolved(resolveTheme(next));
  }, []);

  return { preference, resolved, setTheme };
}

export { STORAGE_KEY as THEME_STORAGE_KEY };
