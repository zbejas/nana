import { useState } from 'react';
import {
  CheckIcon,
  ComputerDesktopIcon,
  MoonIcon,
  SunIcon,
} from '@heroicons/react/24/outline';
import {
  getAutoSaveDelay,
  setAutoSaveDelay,
  setDefaultHomepage,
  useDefaultHomepage,
  type DefaultHomepage,
} from '../../lib/settings';
import { useToasts } from '../../state/hooks';
import { useTheme, type ThemePreference } from '../../lib/theme';
import {
  Button,
  Card,
  Checkbox,
  ConfirmDialog,
  Field,
  SectionHeading,
  SegmentedControl,
  Select,
} from '../ui';

const PRESERVED_STORAGE_KEYS = new Set(['pocketbase_auth', 'nana-last-non-document-route']);

const THEME_OPTIONS: Array<{
  value: ThemePreference;
  label: string;
  description: string;
  icon: typeof SunIcon;
}> = [
  { value: 'system', label: 'System', description: 'Follow your device', icon: ComputerDesktopIcon },
  { value: 'dark', label: 'Night', description: 'Warm ink and ember', icon: MoonIcon },
  { value: 'light', label: 'Day', description: 'Paper and daylight', icon: SunIcon },
];

const AUTOSAVE_PRESETS = [
  { value: '300', label: 'Fast' },
  { value: '600', label: 'Balanced' },
  { value: '1200', label: 'Relaxed' },
];

function closestPreset(delay: number): string {
  return AUTOSAVE_PRESETS.reduce((best, preset) =>
    Math.abs(Number(preset.value) - delay) < Math.abs(Number(best.value) - delay) ? preset : best
  ).value;
}

function ThemePreview({ theme }: { theme: ThemePreference }) {
  const isSystem = theme === 'system';
  const dark = theme === 'dark';

  if (isSystem) {
    return (
      <span
        className="relative block h-16 w-full overflow-hidden rounded-[6px] border border-line"
        style={{ background: '#15100d' }}
        aria-hidden="true"
      >
        <span className="absolute inset-y-0 right-0 w-1/2 bg-[#f3ece0]" />
        <span className="absolute left-2 top-2 flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: '#e8823f' }} />
          <span className="h-1 w-4 rounded-full" style={{ background: '#f3e8d7' }} />
        </span>
        <span className="absolute right-2 top-2 flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: '#bd5320' }} />
          <span className="h-1 w-4 rounded-full" style={{ background: '#241a13' }} />
        </span>
        <span className="absolute bottom-2 left-2 h-1.5 w-6 rounded-full" style={{ background: '#e8823f' }} />
        <span className="absolute bottom-2 right-2 h-1.5 w-6 rounded-full" style={{ background: '#bd5320' }} />
      </span>
    );
  }

  return (
    <span
      className="relative block h-16 w-full overflow-hidden rounded-[6px] border border-line"
      style={{ background: dark ? '#15100d' : '#f3ece0' }}
      aria-hidden="true"
    >
      <span className="absolute inset-x-2 top-2 flex items-center gap-1">
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: dark ? '#e8823f' : '#bd5320' }} />
        <span className="h-1 w-6 rounded-full" style={{ background: dark ? '#f3e8d7' : '#241a13', opacity: 0.8 }} />
      </span>
      <span
        className="absolute left-2 right-2 top-6 h-6 rounded-[3px]"
        style={{
          background: dark ? '#1e1712' : '#fbf6ea',
          border: `1px solid ${dark ? 'rgba(245,226,200,0.12)' : 'rgba(62,45,33,0.14)'}`,
        }}
      />
      <span className="absolute bottom-2 left-2 h-1.5 w-8 rounded-full" style={{ background: dark ? '#e8823f' : '#bd5320' }} />
    </span>
  );
}

export function PreferencesTab() {
  const { showToast } = useToasts();
  const { preference, setTheme } = useTheme();
  const homepage = useDefaultHomepage();
  const [autosave, setAutosave] = useState(() => closestPreset(getAutoSaveDelay()));
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetIncludesSessions, setResetIncludesSessions] = useState(true);

  const handleThemeChange = (value: ThemePreference) => {
    setTheme(value);
    showToast('Appearance updated', 'success');
  };

  const handleHomepageChange = (value: DefaultHomepage) => {
    setDefaultHomepage(value);
    showToast('Start page updated', 'success');
  };

  const handleAutosaveChange = (value: string) => {
    setAutosave(value);
    setAutoSaveDelay(Number(value));
  };

  const handleReset = () => {
    try {
      for (const key of Object.keys(localStorage)) {
        if (!PRESERVED_STORAGE_KEYS.has(key)) {
          localStorage.removeItem(key);
        }
      }
      if (resetIncludesSessions) {
        sessionStorage.clear();
        localStorage.removeItem('pocketbase_auth');
      }
    } finally {
      setConfirmReset(false);
      window.location.reload();
    }
  };

  return (
    <div className="space-y-5">
      <Card className="p-5 sm:p-6">
        <SectionHeading
          eyebrow="Appearance"
          title="Choose your light"
          description="Nana has a warm night desk and a daylight paper mode. Both use the same ember accent."
        />
        <div role="radiogroup" aria-label="Appearance" className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {THEME_OPTIONS.map((option) => {
            const active = preference === option.value;
            const Icon = option.icon;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => handleThemeChange(option.value)}
                className={`rounded-control border p-2.5 text-left transition-colors ${
                  active
                    ? 'border-ember/50 bg-ember-soft'
                    : 'border-line bg-surface-sunken/40 hover:border-line-strong hover:bg-surface-sunken'
                }`}
              >
                <ThemePreview theme={option.value} />
                <span className="mt-2.5 flex items-center gap-2">
                  <Icon className={`h-4 w-4 ${active ? 'text-ember' : 'text-ink-muted'}`} />
                  <span className="flex-1">
                    <span className="block text-[13px] font-medium text-ink">{option.label}</span>
                    <span className="block text-[11px] text-ink-muted">{option.description}</span>
                  </span>
                  {active && <CheckIcon className="h-4 w-4 text-ember" />}
                </span>
              </button>
            );
          })}
        </div>
      </Card>

      <Card className="p-5 sm:p-6">
        <SectionHeading
          eyebrow="Workspace"
          title="Where a session begins"
          description="The page Nana opens when you sign in or return to the app."
        />
        <div className="mt-5 max-w-sm">
          <Field label="Start page" htmlFor="settings-homepage">
            <Select
              id="settings-homepage"
              value={homepage}
              onChange={(event) => handleHomepageChange(event.target.value as DefaultHomepage)}
            >
              <option value="timeline">Timeline</option>
              <option value="board">Board</option>
              <option value="folders">Folders</option>
              <option value="chat">Chat</option>
            </Select>
          </Field>
        </div>
      </Card>

      <Card className="p-5 sm:p-6">
        <SectionHeading
          eyebrow="Writing"
          title="Auto-save rhythm"
          description="How long Nana waits after you stop typing before saving. You can always save immediately with the editor."
        />
        <div className="mt-5 flex flex-wrap items-center gap-4">
          <SegmentedControl
            label="Auto-save rhythm"
            value={autosave}
            onChange={handleAutosaveChange}
            options={AUTOSAVE_PRESETS}
          />
          <p className="text-xs text-ink-muted">
            Saves about{' '}
            <span className="font-medium text-ink-secondary">
              {autosave === '300' ? '0.3' : autosave === '600' ? '0.6' : '1.2'}s
            </span>{' '}
            after the last keystroke.
          </p>
        </div>
      </Card>

      <Card className="p-5 sm:p-6">
        <SectionHeading
          eyebrow="This browser"
          title="Local data"
          description="Preferences live in this browser. Clearing them keeps your account, notes, and files untouched."
        />
        <div className="mt-5 space-y-4">
          <Checkbox
            id="reset-sessions"
            checked={resetIncludesSessions}
            onChange={setResetIncludesSessions}
            label="Also forget this browser session"
            description="You will need to sign in again after reloading."
          />
          <Button variant="danger" onClick={() => setConfirmReset(true)}>
            Reset local preferences
          </Button>
        </div>
      </Card>

      <ConfirmDialog
        open={confirmReset}
        title="Reset local data?"
        description="Theme, start page, auto-save, sidebar width, and expanded folders return to their defaults. Your notes and account stay in PocketBase."
        confirmLabel="Reset and reload"
        tone="danger"
        onConfirm={handleReset}
        onCancel={() => setConfirmReset(false)}
      />
    </div>
  );
}
