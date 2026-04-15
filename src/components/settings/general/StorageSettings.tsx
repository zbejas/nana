import { useState } from 'react';

const PRESERVED_STORAGE_KEYS = new Set([
  'pocketbase_auth',
  'nana-last-non-document-route',
]);

export function StorageSettings() {
  const [status, setStatus] = useState<string>('');

  const handleResetLocalData = () => {
    let removedCount = 0;

    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
      const key = localStorage.key(index);
      if (!key || PRESERVED_STORAGE_KEYS.has(key)) {
        continue;
      }

      localStorage.removeItem(key);
      removedCount += 1;
    }

    setStatus(`Cleared ${removedCount} saved setting${removedCount === 1 ? '' : 's'}.`);
  };

  return (
    <div className="bg-white/5 rounded-lg p-6 border border-white/10">
      <h3 className="text-lg font-semibold text-white mb-4">Storage</h3>

      <div className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium text-gray-200">Reset local app data</p>
            <p className="text-xs text-gray-500 mt-1">
              This clears saved app preferences and restores defaults, while keeping you signed in.
            </p>
          </div>

          <button
            type="button"
            onClick={handleResetLocalData}
            className="px-3 py-2 rounded-lg bg-blue-500/20 text-blue-300 border border-blue-500/30 hover:bg-blue-500/30 transition-colors text-sm font-medium whitespace-nowrap"
          >
            Reset local data
          </button>
        </div>

        {status && <p className="text-xs text-green-400">{status}</p>}
      </div>
    </div>
  );
}
