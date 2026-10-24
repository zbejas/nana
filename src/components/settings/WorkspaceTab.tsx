import { useNavigate } from 'react-router-dom';
import {
  CpuChipIcon,
  EnvelopeIcon,
  KeyIcon,
  ServerStackIcon,
  UserGroupIcon,
} from '@heroicons/react/24/outline';
import { SectionHeading } from '../ui';
import { InstanceSettings } from './admin/InstanceSettings';
import { LimitsSettings } from './admin/LimitsSettings';
import { UsersTab } from './admin/UsersTab';
import { SMTPSettings } from './admin/SMTPSettings';
import { OAuthSettings } from './admin/OAuthSettings';
import { AISettings } from './admin/AISettings';

export type WorkspaceSection = 'general' | 'people' | 'email' | 'signin' | 'ai';

const SECTIONS: Array<{
  key: WorkspaceSection;
  label: string;
  icon: typeof ServerStackIcon;
  description: string;
}> = [
  { key: 'general', label: 'General', icon: ServerStackIcon, description: 'Address, storage, and request limits' },
  { key: 'people', label: 'People', icon: UserGroupIcon, description: 'Members and their access' },
  { key: 'email', label: 'Email', icon: EnvelopeIcon, description: 'Outgoing mail and sender identity' },
  { key: 'signin', label: 'Sign-in', icon: KeyIcon, description: 'OAuth providers' },
  { key: 'ai', label: 'AI & search', icon: CpuChipIcon, description: 'Models, prompts, and embeddings' },
];

interface WorkspaceTabProps {
  section: WorkspaceSection;
}

export function WorkspaceTab({ section }: WorkspaceTabProps) {
  const navigate = useNavigate();
  const active = SECTIONS.find((item) => item.key === section) ?? SECTIONS[0]!;

  return (
    <div className="space-y-6">
      <div>
        <SectionHeading
          eyebrow="Instance"
          title="Workspace administration"
          description="These settings apply to everyone using this Nana instance."
        />
        <div className="mt-4 flex gap-1.5 overflow-x-auto pb-1 scrollbar-hide" role="tablist" aria-label="Workspace sections">
          {SECTIONS.map((item) => {
            const Icon = item.icon;
            const isActive = item.key === active.key;
            return (
              <button
                key={item.key}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => navigate(`/settings/admin/${item.key}`)}
                className={`inline-flex h-8 shrink-0 items-center gap-2 rounded-full border px-3 text-[12px] transition-colors ${
                  isActive
                    ? 'border-ember/35 bg-ember-soft text-ember'
                    : 'border-line bg-surface text-ink-secondary hover:border-line-strong hover:text-ink'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {item.label}
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-ink-muted">{active.description}</p>
      </div>

      <div key={active.key} className="settings-tab-content-enter space-y-5">
        {active.key === 'general' && (
          <>
            <InstanceSettings />
            <LimitsSettings />
          </>
        )}
        {active.key === 'people' && <UsersTab />}
        {active.key === 'email' && <SMTPSettings />}
        {active.key === 'signin' && <OAuthSettings />}
        {active.key === 'ai' && <AISettings />}
      </div>
    </div>
  );
}
