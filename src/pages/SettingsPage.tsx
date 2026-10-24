import { useNavigate, useParams } from 'react-router-dom';
import {
  AdjustmentsHorizontalIcon,
  BuildingOffice2Icon,
  InformationCircleIcon,
  UserCircleIcon,
} from '@heroicons/react/24/outline';
import { useAuth } from '../lib/auth';
import { PageHeader } from '../components/ui';
import { AccountTab } from '../components/settings/AccountTab';
import { PreferencesTab } from '../components/settings/PreferencesTab';
import { WorkspaceTab, type WorkspaceSection } from '../components/settings/WorkspaceTab';
import { AboutTab } from '../components/settings/AboutTab';

type SettingsTab = 'account' | 'preferences' | 'admin' | 'about';

const TABS: Array<{
  key: SettingsTab;
  label: string;
  icon: typeof UserCircleIcon;
  adminOnly?: boolean;
}> = [
  { key: 'account', label: 'Account', icon: UserCircleIcon },
  { key: 'preferences', label: 'Preferences', icon: AdjustmentsHorizontalIcon },
  { key: 'admin', label: 'Workspace', icon: BuildingOffice2Icon, adminOnly: true },
  { key: 'about', label: 'About', icon: InformationCircleIcon },
];

const WORKSPACE_SECTIONS = new Set<WorkspaceSection>(['general', 'people', 'email', 'signin', 'ai']);

export function SettingsPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const { tab, section } = useParams<{ tab?: string; section?: string }>();

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <span className="h-8 w-8 animate-spin rounded-full border-2 border-line-strong border-t-signal" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-ink-muted">Sign in to open settings.</p>
      </div>
    );
  }

  const isAdmin = Boolean(user.admin);
  const activeTab: SettingsTab = TABS.some((item) => item.key === tab && (!item.adminOnly || isAdmin))
    ? (tab as SettingsTab)
    : 'account';

  const workspaceSection: WorkspaceSection = WORKSPACE_SECTIONS.has(section as WorkspaceSection)
    ? (section as WorkspaceSection)
    : 'general';

  const goToTab = (next: SettingsTab) => {
    navigate(next === 'admin' ? '/settings/admin/general' : `/settings/${next}`);
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-6xl px-4 py-6 pb-24 sm:px-6 lg:px-8 lg:py-8 md:pb-8">
        <PageHeader
          eyebrow="Your workspace"
          title="Settings"
          description="Your account, how Nana feels, and the instance behind it."
        />

        <div className="flex flex-col gap-6 lg:flex-row lg:gap-10">
          <nav aria-label="Settings sections" className="shrink-0 lg:w-48">
            <div className="grid grid-cols-2 gap-1.5 pb-2 lg:flex lg:flex-col lg:gap-0.5 lg:overflow-visible lg:pb-0">
              {TABS.filter((item) => !item.adminOnly || isAdmin).map((item) => {
                const Icon = item.icon;
                const active = activeTab === item.key;
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => goToTab(item.key)}
                    aria-current={active ? 'page' : undefined}
                    className={`inline-flex h-9 w-full items-center gap-2.5 rounded-control px-3 text-[13px] transition-colors ${
                      active
                        ? 'bg-signal-soft font-medium text-signal'
                        : 'text-ink-secondary hover:bg-surface-raised hover:text-ink'
                    }`}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    {item.label}
                  </button>
                );
              })}
            </div>
          </nav>

          <div key={`${activeTab}:${workspaceSection}`} className="settings-tab-content-enter min-w-0 flex-1">
            {activeTab === 'account' && <AccountTab user={user} />}
            {activeTab === 'preferences' && <PreferencesTab />}
            {activeTab === 'admin' && <WorkspaceTab section={workspaceSection} />}
            {activeTab === 'about' && <AboutTab />}
          </div>
        </div>
      </div>
    </div>
  );
}

export default SettingsPage;
