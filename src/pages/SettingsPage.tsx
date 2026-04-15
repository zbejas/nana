import { Navigate, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { type ComponentType } from "react";
import { Cog6ToothIcon, ShieldCheckIcon, InformationCircleIcon } from '@heroicons/react/24/outline';
import { ProfileSection } from "../components/settings/ProfileSection";
import { GeneralTab } from "../components/settings/GeneralTab";
import { AdminTab } from "../components/settings/AdminTab";
import { AboutTab } from "../components/settings/AboutTab";

type SettingsTab = 'general' | 'admin' | 'about';

export function SettingsPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const { tab } = useParams<{ tab?: string }>();
  
  const isAdmin = user?.admin === true;

  const isValidTab = (value: string | undefined): value is SettingsTab => {
    return value === 'general' || value === 'admin' || value === 'about';
  };

  const requestedTab: SettingsTab = isValidTab(tab) ? tab : 'general';
  const activeTab: SettingsTab = requestedTab === 'admin' && !isAdmin ? 'general' : requestedTab;

  const tabs: Array<{ id: SettingsTab; label: string; icon: ComponentType<{ className?: string }> }> = [
    { id: 'general', label: 'General', icon: Cog6ToothIcon },
    ...(isAdmin ? [{ id: 'admin' as const, label: 'Admin', icon: ShieldCheckIcon }] : []),
    { id: 'about', label: 'About', icon: InformationCircleIcon },
  ];

  const renderActiveTabContent = () => {
    if (activeTab === 'general') {
      return (
        <>
          <ProfileSection user={user} />
          <GeneralTab />
        </>
      );
    }

    if (activeTab === 'admin' && isAdmin) {
      return <AdminTab />;
    }

    return <AboutTab />;
  };

  if (loading) {
    return (
      <div className="h-full bg-black/40 backdrop-blur-md overflow-hidden">
        <div className="desktop-page-content-enter h-full max-w-6xl mx-auto px-3 py-3 sm:p-6 flex items-center justify-center">
          <p className="text-gray-400">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="h-full bg-black/40 backdrop-blur-md overflow-hidden">
      <div className="desktop-page-content-enter h-full max-w-6xl mx-auto px-3 py-3 sm:p-6 flex flex-col gap-4">
        <header>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2 text-white">
                <Cog6ToothIcon className="w-5 h-5 text-blue-400" />
                <h1 className="text-xl font-bold text-white">Settings</h1>
              </div>
              <p className="text-xs text-gray-400 mt-1">Account, app behavior, and instance configuration.</p>
            </div>

            <div className="grid w-full gap-1.5 [grid-template-columns:repeat(auto-fit,minmax(96px,1fr))] sm:flex sm:w-auto sm:flex-wrap sm:justify-end">
              {tabs.map((tab) => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.id;

                return (
                  <button
                    key={tab.id}
                    onClick={() => navigate(tab.id === 'general' ? '/settings' : `/settings/${tab.id}`)}
                    className={`inline-flex w-full items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30 sm:min-w-[96px] sm:w-auto ${
                      isActive
                        ? 'bg-blue-500/20 border-blue-500/30 text-blue-100'
                        : 'bg-white/5 border-white/10 text-gray-300 hover:bg-white/10'
                    }`}
                  >
                    <span className="flex h-5 w-5 items-center justify-center">
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="leading-none">{tab.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </header>

        <main className="w-full min-h-0 flex-1 overflow-y-auto scrollbar-autohide">
          <div key={activeTab} className="settings-tab-content-enter">
            {renderActiveTabContent()}
          </div>
        </main>
      </div>
    </div>
  );
}

export default SettingsPage;
