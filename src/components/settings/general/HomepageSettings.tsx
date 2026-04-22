import { useDefaultHomepage, setDefaultHomepage, type DefaultHomepage } from '../../../lib/settings';
import { SettingsSelect } from '../SettingsSelect';

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
        <SettingsSelect
          id="default_homepage"
          value={defaultHomepage}
          onChange={(e) => setDefaultHomepage(e.target.value as DefaultHomepage)}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </SettingsSelect>

        <p className="text-xs text-gray-500">
          {selectedOption?.description}
        </p>
      </div>
    </div>
  );
}
