import { PerformanceSettings } from './general/PerformanceSettings';
import { AutoSaveSettings } from './general/AutoSaveSettings';
import { HomepageSettings } from './general/HomepageSettings';
import { StorageSettings } from './general/StorageSettings';

export function GeneralTab() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <HomepageSettings />
        <PerformanceSettings />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <AutoSaveSettings />
        <StorageSettings />
      </div>
    </div>
  );
}
