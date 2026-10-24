import { useEffect, useState } from 'react';
import { pb } from '../../../lib/pocketbase';
import { PlusIcon, TrashIcon, ChevronDownIcon, ChevronUpIcon } from '@heroicons/react/24/outline';
import {
  Badge,
  Button,
  Card,
  Field,
  Input,
  SectionHeading,
  Spinner,
  Switch,
} from '../../ui';

type OAuthProvider = {
  name: string;
  displayName: string;
  clientId: string;
  clientSecret: string;
  authURL: string;
  tokenURL: string;
  userInfoURL: string;
};

type OAuthForm = {
  enabled: boolean;
  providers: OAuthProvider[];
};

const KNOWN_PROVIDERS = [
  { name: 'oidc', label: 'OpenID Connect (OIDC)', hint: 'Authelia, Keycloak, Authentik, etc.' },
  { name: 'oidc2', label: 'OpenID Connect 2', hint: 'Second OIDC provider' },
  { name: 'oidc3', label: 'OpenID Connect 3', hint: 'Third OIDC provider' },
  { name: 'google', label: 'Google', hint: '' },
  { name: 'github', label: 'GitHub', hint: '' },
  { name: 'microsoft', label: 'Microsoft', hint: '' },
  { name: 'gitlab', label: 'GitLab', hint: '' },
  { name: 'discord', label: 'Discord', hint: '' },
  { name: 'gitea', label: 'Gitea', hint: '' },
  { name: 'apple', label: 'Apple', hint: '' },
] as const;

const OIDC_NAMES = new Set(['oidc', 'oidc2', 'oidc3']);

const emptyProvider = (name: string): OAuthProvider => ({
  name,
  displayName: KNOWN_PROVIDERS.find(p => p.name === name)?.label ?? name,
  clientId: '',
  clientSecret: '',
  authURL: '',
  tokenURL: '',
  userInfoURL: '',
});

export function OAuthSettings() {
  const [form, setForm] = useState<OAuthForm>({ enabled: false, providers: [] });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const isAuthenticated = pb.authStore.isValid;
  const redirectUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/pb/api/oauth2-redirect`
    : '';

  const buildHeaders = (): HeadersInit => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const token = pb.authStore.token;
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
  };

  useEffect(() => {
    const load = async () => {
      if (!isAuthenticated) {
        setError('Admin authentication required to manage OAuth2.');
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const res = await fetch('/pb/api/admin/oauth/providers', {
          headers: buildHeaders(),
        });
        if (!res.ok) throw new Error(`Failed to load settings (${res.status})`);
        const data = await res.json();
        setForm({
          enabled: !!data.enabled,
          providers: (data.providers || []).map((p: any) => ({
            name: p.name || '',
            displayName: p.displayName || '',
            clientId: p.clientId || '',
            clientSecret: '',
            authURL: p.authURL || '',
            tokenURL: p.tokenURL || '',
            userInfoURL: p.userInfoURL || '',
          })),
        });
      } catch (err: any) {
        setError(err.message || 'Failed to load OAuth2 settings');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [isAuthenticated]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      const payload = {
        enabled: form.enabled,
        providers: form.providers.map(p => ({
          ...p,
          clientSecret: p.clientSecret || '••••••••',
        })),
      };

      const res = await fetch('/pb/api/admin/oauth/providers', {
        method: 'PATCH',
        headers: buildHeaders(),
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Failed to save (${res.status})`);
      }

      setMessage('OAuth2 settings updated.');
      setForm(prev => ({
        ...prev,
        providers: prev.providers.map(p => ({ ...p, clientSecret: '' })),
      }));
    } catch (err: any) {
      setError(err.message || 'Failed to save OAuth2 settings');
    } finally {
      setSaving(false);
    }
  };

  const addProvider = (name: string) => {
    if (form.providers.some(p => p.name === name)) return;
    setForm(prev => ({
      ...prev,
      providers: [...prev.providers, emptyProvider(name)],
    }));
    setExpanded(name);
  };

  const removeProvider = (name: string) => {
    setForm(prev => ({
      ...prev,
      providers: prev.providers.filter(p => p.name !== name),
    }));
    if (expanded === name) setExpanded(null);
  };

  const updateProvider = (name: string, field: keyof OAuthProvider, value: string) => {
    setForm(prev => ({
      ...prev,
      providers: prev.providers.map(p =>
        p.name === name ? { ...p, [field]: value } : p
      ),
    }));
  };

  const usedNames = new Set(form.providers.map(p => p.name));
  const availableProviders = KNOWN_PROVIDERS.filter(p => !usedNames.has(p.name));
  const toggleDisabled = !isAuthenticated || loading || saving;
  const formDisabled = toggleDisabled || !form.enabled;

  if (loading) {
    return (
      <Card className="p-5 sm:p-6">
        <div className="flex items-center gap-3 text-sm text-ink-secondary">
          <Spinner />
          Loading OAuth2 settings...
        </div>
      </Card>
    );
  }

  return (
    <form onSubmit={handleSave}>
      <Card className="p-5 sm:p-6">
        <SectionHeading
          title="OAuth2 / OpenID Connect"
          description="Allow users to sign in with external identity providers."
        />

        <Switch
          id="oauth-enabled"
          className="mt-5"
          label="Enable OAuth2"
          checked={form.enabled}
          onChange={enabled => setForm(prev => ({ ...prev, enabled }))}
          disabled={toggleDisabled}
        />

        {error && (
          <p className="mt-4 text-sm text-danger" role="alert">
            {error}
          </p>
        )}
        {message && (
          <p className="mt-4 text-sm text-sage" role="status">
            {message}
          </p>
        )}

        {form.enabled && redirectUrl && (
          <div className="mt-5 rounded-control border border-line bg-surface-sunken/50 px-3.5 py-3">
            <p className="text-sm text-ink-secondary">
              <span className="font-medium text-ink">Redirect URL</span> — register this in your OAuth2 provider:
            </p>
            <code className="mt-2 block select-all break-all rounded bg-surface-raised px-2.5 py-1.5 font-mono text-xs text-brass">
              {redirectUrl}
            </code>
          </div>
        )}

        {form.providers.length > 0 && (
          <div className="mt-5 space-y-3">
            {form.providers.map(provider => {
              const isOIDC = OIDC_NAMES.has(provider.name);
              const isOpen = expanded === provider.name;
              const meta = KNOWN_PROVIDERS.find(p => p.name === provider.name);

              return (
                <div
                  key={provider.name}
                  className="overflow-hidden rounded-control border border-line bg-surface-sunken/30"
                >
                  <button
                    type="button"
                    onClick={() => setExpanded(isOpen ? null : provider.name)}
                    aria-expanded={isOpen}
                    className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-raised"
                  >
                    <span className="flex min-w-0 flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-ink">
                        {provider.displayName || meta?.label || provider.name}
                      </span>
                      {provider.clientId && <Badge tone="sage">Configured</Badge>}
                    </span>
                    {isOpen ? (
                      <ChevronUpIcon className="h-4 w-4 shrink-0 text-ink-muted" />
                    ) : (
                      <ChevronDownIcon className="h-4 w-4 shrink-0 text-ink-muted" />
                    )}
                  </button>

                  {isOpen && (
                    <div className="space-y-4 border-t border-line p-4">
                      <Field
                        label="Display name"
                        htmlFor={`oauth-${provider.name}-display-name`}
                      >
                        <Input
                          id={`oauth-${provider.name}-display-name`}
                          type="text"
                          value={provider.displayName}
                          onChange={e => updateProvider(provider.name, 'displayName', e.target.value)}
                          placeholder={meta?.label || provider.name}
                          disabled={formDisabled}
                        />
                      </Field>

                      <div className="grid gap-4 sm:grid-cols-2">
                        <Field label="Client ID" htmlFor={`oauth-${provider.name}-client-id`}>
                          <Input
                            id={`oauth-${provider.name}-client-id`}
                            type="text"
                            value={provider.clientId}
                            onChange={e => updateProvider(provider.name, 'clientId', e.target.value)}
                            placeholder="Client ID"
                            disabled={formDisabled}
                          />
                        </Field>
                        <Field
                          label="Client secret"
                          hint="Leave blank to keep current"
                          htmlFor={`oauth-${provider.name}-client-secret`}
                        >
                          <Input
                            id={`oauth-${provider.name}-client-secret`}
                            type="password"
                            value={provider.clientSecret}
                            onChange={e => updateProvider(provider.name, 'clientSecret', e.target.value)}
                            placeholder="••••••••"
                            disabled={formDisabled}
                          />
                        </Field>
                      </div>

                      {isOIDC && (
                        <div className="space-y-4 border-t border-line pt-4">
                          <p className="text-xs leading-relaxed text-ink-muted">
                            {meta?.hint ? `${meta.hint} — ` : ''}Enter your provider's OIDC endpoint URLs
                          </p>
                          <Field
                            label="Authorization URL"
                            htmlFor={`oauth-${provider.name}-auth-url`}
                          >
                            <Input
                              id={`oauth-${provider.name}-auth-url`}
                              type="url"
                              value={provider.authURL}
                              onChange={e => updateProvider(provider.name, 'authURL', e.target.value)}
                              placeholder="https://auth.example.com/api/oidc/authorization"
                              disabled={formDisabled}
                            />
                          </Field>
                          <Field
                            label="Token URL"
                            htmlFor={`oauth-${provider.name}-token-url`}
                          >
                            <Input
                              id={`oauth-${provider.name}-token-url`}
                              type="url"
                              value={provider.tokenURL}
                              onChange={e => updateProvider(provider.name, 'tokenURL', e.target.value)}
                              placeholder="https://auth.example.com/api/oidc/token"
                              disabled={formDisabled}
                            />
                          </Field>
                          <Field
                            label="User info URL"
                            hint="Optional if discovery is supported"
                            htmlFor={`oauth-${provider.name}-userinfo-url`}
                          >
                            <Input
                              id={`oauth-${provider.name}-userinfo-url`}
                              type="url"
                              value={provider.userInfoURL}
                              onChange={e => updateProvider(provider.name, 'userInfoURL', e.target.value)}
                              placeholder="https://auth.example.com/api/oidc/userinfo"
                              disabled={formDisabled}
                            />
                          </Field>
                        </div>
                      )}

                      <div className="flex justify-end border-t border-line pt-3">
                        <Button
                          type="button"
                          variant="danger"
                          size="sm"
                          icon={<TrashIcon className="h-4 w-4" />}
                          onClick={() => removeProvider(provider.name)}
                          disabled={formDisabled}
                        >
                          Remove
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {form.enabled && availableProviders.length > 0 && (
          <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-line pt-5">
            <span className="text-sm text-ink-muted">Add provider</span>
            {availableProviders.map(p => (
              <Button
                key={p.name}
                type="button"
                variant="secondary"
                size="sm"
                icon={<PlusIcon className="h-3.5 w-3.5" />}
                onClick={() => addProvider(p.name)}
                disabled={formDisabled}
              >
                {p.label}
              </Button>
            ))}
          </div>
        )}

        <div className="mt-5 flex justify-end border-t border-line pt-5">
          <Button type="submit" variant="primary" loading={saving} disabled={toggleDisabled}>
            Save OAuth2
          </Button>
        </div>
      </Card>
    </form>
  );
}
