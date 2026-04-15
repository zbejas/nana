import { useState } from 'react';
import {
  getAutoSaveDelay,
  setAutoSaveDelay,
  MIN_AUTO_SAVE_DELAY,
  DEFAULT_AUTO_SAVE_DELAY,
} from '../../../lib/settings';

export function AutoSaveSettings() {
  const [autoSaveDelayInput, setAutoSaveDelayInput] = useState<string>(String(getAutoSaveDelay()));

  const handleAutoSaveDelaySave = () => {
    const parsedDelay = Number.parseInt(autoSaveDelayInput, 10);
    const normalizedDelay = Math.max(
      MIN_AUTO_SAVE_DELAY,
      Number.isNaN(parsedDelay) ? DEFAULT_AUTO_SAVE_DELAY : parsedDelay,
    );
    setAutoSaveDelayInput(String(normalizedDelay));
    setAutoSaveDelay(normalizedDelay);
  };

  return (
    <div className="bg-white/5 rounded-lg p-6 border border-white/10">
      <h3 className="text-lg font-semibold text-white mb-4">Auto-save</h3>
      <div className="space-y-2">
        <label htmlFor="auto_save_delay" className="block text-sm font-medium text-gray-300">
          Delay (ms)
        </label>
        <input
          id="auto_save_delay"
          type="number"
          min={MIN_AUTO_SAVE_DELAY}
          step={50}
          value={autoSaveDelayInput}
          onChange={(e) => {
            setAutoSaveDelayInput(e.target.value);
          }}
          onBlur={handleAutoSaveDelaySave}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              handleAutoSaveDelaySave();
            }
          }}
          className="w-full rounded-lg border border-white/20 bg-black/30 px-4 py-2.5 text-sm text-white placeholder-gray-500 transition-colors focus:border-blue-500/50 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
        />
        <p className="text-xs text-gray-500">
          Default is <code className="rounded bg-white/10 px-1 py-0.5">600ms</code>. Minimum is{' '}
          <code className="rounded bg-white/10 px-1 py-0.5">{MIN_AUTO_SAVE_DELAY}ms</code>.
        </p>
      </div>
    </div>
  );
}
