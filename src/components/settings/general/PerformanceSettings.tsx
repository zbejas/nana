import { useState } from 'react';
import { getLowPowerMode, setLowPowerMode } from '../../../lib/settings';

export function PerformanceSettings() {
  const [lowPowerMode, setLowPowerModeState] = useState<boolean>(getLowPowerMode());

  const handleToggle = (enabled: boolean) => {
    setLowPowerModeState(enabled);
    setLowPowerMode(enabled);
  };

  return (
    <div className="bg-white/5 rounded-lg p-6 border border-white/10">
      <h3 className="text-lg font-semibold text-white mb-4">Performance</h3>

      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-gray-200">Low Power Mode</p>
          <p className="text-xs text-gray-500 mt-1">
            Disables the animated background to reduce GPU usage on low-end devices or when using battery saver.
          </p>
        </div>
        <label className="inline-flex items-center cursor-pointer select-none">
          <input
            type="checkbox"
            checked={lowPowerMode}
            onChange={(e) => handleToggle(e.target.checked)}
            className="sr-only"
            aria-label="Toggle low power mode"
          />
          <span
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 ${
              lowPowerMode ? 'bg-green-500' : 'bg-white/20'
            }`}
          >
            <span
              className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform duration-200 ${
                lowPowerMode ? 'translate-x-5' : 'translate-x-1'
              }`}
            />
          </span>
        </label>
      </div>
    </div>
  );
}
