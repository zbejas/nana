import { useState, type ComponentType } from 'react';
import { Cog6ToothIcon, UserGroupIcon, EnvelopeIcon, KeyIcon, CpuChipIcon } from '@heroicons/react/24/outline';
import { InstanceSettings } from './admin/InstanceSettings';
import { UsersTab } from './admin/UsersTab';
import { SMTPSettings } from './admin/SMTPSettings';
import { OAuthSettings } from './admin/OAuthSettings';
import { AISettings } from './admin/AISettings';

type AdminSubTab = 'instance' | 'users' | 'smtp' | 'oauth' | 'ai';

type AdminTabConfig = {
  id: AdminSubTab;
  label: string;
  icon: ComponentType<{ className?: string }>;
};

const adminTabs: AdminTabConfig[] = [
  {
    id: 'instance',
    label: 'Instance',
    icon: Cog6ToothIcon,
  },
  {
    id: 'users',
    label: 'Users',
    icon: UserGroupIcon,
  },
  {
    id: 'smtp',
    label: 'SMTP',
    icon: EnvelopeIcon,
  },
  {
    id: 'oauth',
    label: 'OAuth',
    icon: KeyIcon,
  },
  {
    id: 'ai',
    label: 'AI',
    icon: CpuChipIcon,
  },
];

export function AdminTab() {
  const [activeSubTab, setActiveSubTab] = useState<AdminSubTab>('instance');

  const renderActiveSubTabContent = () => {
    if (activeSubTab === 'instance') return <InstanceSettings />;
    if (activeSubTab === 'users') return <UsersTab />;
    if (activeSubTab === 'smtp') return <SMTPSettings />;
    if (activeSubTab === 'oauth') return <OAuthSettings />;
    return <AISettings />;
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-2">
        {adminTabs.map((tab, index) => {
          const Icon = tab.icon;
          const isActive = activeSubTab === tab.id;
          const isOddLastMobile = adminTabs.length % 2 === 1 && index === adminTabs.length - 1;

          return (
            <button
              key={tab.id}
              onClick={() => setActiveSubTab(tab.id)}
              className={`inline-flex w-full min-w-[96px] items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30 ${isOddLastMobile ? 'col-span-2 sm:col-span-1' : ''} ${
                isActive
                  ? 'bg-blue-500/20 border-blue-500/30 text-blue-100'
                  : 'bg-white/5 border-white/10 text-gray-300 hover:bg-white/10'
              }`}
            >
              <span className="flex h-5 w-5 items-center justify-center">
                <Icon className="h-4 w-4" />
              </span>
              <span className="leading-none text-left">{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Sub-tab Content */}
      <div key={activeSubTab} className="settings-tab-content-enter">
        {renderActiveSubTabContent()}
      </div>
    </div>
  );
}
