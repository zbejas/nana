import { useDefaultHomepage, setDefaultHomepage, type DefaultHomepage } from '../../../lib/settings';
import { ChevronUpDownIcon } from '@heroicons/react/24/outline';

const options: Array<{ value: DefaultHomepage; label: string; description: string }> = [
  {
    value: 'timeline',
    label: 'Timeline',
    description: 'Open timeline view when loading the web app.',
  },
  {
    value: 'folders',
    label: 'Folder View',
    description: 'Open folder explorer view when loading the web app.',
  },
  {
    value: 'chat',
    label: 'Chat',
    description: 'Open the prototype AI chat page.',
  },
];

export function HomepageSettings() {
  const defaultHomepage = useDefaultHomepage();
  const selectedOption = options.find((option) => option.value === defaultHomepage);

  return (
    <div className="bg-white/5 rounded-lg p-6 border border-white/10">
      <h3 className="text-lg font-semibold text-white mb-4">Homepage</h3>

      <div className="space-y-2">
        <label htmlFor="default_homepage" className="block text-sm font-medium text-gray-300">
          Default page
        </label>
        <div className="relative">
          <select
            id="default_homepage"
            value={defaultHomepage}
            onChange={(e) => setDefaultHomepage(e.target.value as DefaultHomepage)}
            className="w-full appearance-none rounded-lg border border-white/20 bg-black/30 pl-5 pr-12 py-3 text-sm text-white transition-colors focus:border-blue-500/50 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          >
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-gray-400" aria-hidden="true">
            <ChevronUpDownIcon className="h-4 w-4" />
          </span>
        </div>

        <p className="text-xs text-gray-500">
          {selectedOption?.description}
        </p>
      </div>
    </div>
  );
}
