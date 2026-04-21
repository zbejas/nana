import { useEffect, useState } from 'react';
import { pb } from '../../../lib/pocketbase';
import { PlusIcon, TrashIcon, ChevronDownIcon, ChevronUpIcon } from '@heroicons/react/24/outline';

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
      <div className="space-y-4">
        <div className="bg-white/5 rounded-lg p-6 border border-white/10">
          <p className="text-gray-400 text-sm">Loading OAuth2 settings...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <form onSubmit={handleSave}>
        <div className="bg-white/5 rounded-lg p-6 border border-white/10 space-y-4">
          {/* Header + Toggle */}
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className="text-lg font-semibold text-white">OAuth2 / OpenID Connect</h3>
              <p className="text-xs text-gray-400 mt-1">
                Allow users to sign in with external identity providers
              </p>
            </div>
            <label className="inline-flex items-center gap-2.5 text-sm text-gray-300 cursor-pointer hover:text-white transition-colors">
              <div className="relative inline-flex items-center justify-center flex-shrink-0">
                <input
                  type="checkbox"
                  checked={form.enabled}
                  onChange={e => setForm(prev => ({ ...prev, enabled: e.target.checked }))}
                  className="appearance-none w-5 h-5 rounded border-2 border-white/30 bg-black/40 cursor-pointer transition-all
                             hover:border-white/50 hover:bg-black/60
                             focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:ring-offset-2 focus:ring-offset-black
                             checked:bg-blue-500 checked:border-blue-500 checked:hover:bg-blue-600 checked:hover:border-blue-600
                             disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={toggleDisabled}
                />
                {form.enabled && (
                  <svg className="absolute inset-0 w-5 h-5 text-white pointer-events-none" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                )}
              </div>
              <span className="select-none leading-5">Enable OAuth2</span>
            </label>
          </div>

          {error && <div className="rounded bg-red-900/30 border border-red-700 text-red-200 px-3 py-2 text-sm">{error}</div>}
          {message && <div className="rounded bg-green-900/30 border border-green-700 text-green-200 px-3 py-2 text-sm">{message}</div>}

          {/* Redirect URL info */}
          {form.enabled && redirectUrl && (
            <div className="rounded bg-blue-900/20 border border-blue-800/40 px-3 py-2 text-sm text-blue-200">
              <span className="font-medium">Redirect URL</span> — register this in your OAuth2 provider:
              <code className="block mt-1 bg-black/30 rounded px-2 py-1 text-xs text-blue-100 break-all select-all">
                {redirectUrl}
              </code>
            </div>
          )}

          {/* Providers */}
          {form.providers.map(provider => {
            const isOIDC = OIDC_NAMES.has(provider.name);
            const isOpen = expanded === provider.name;
            const meta = KNOWN_PROVIDERS.find(p => p.name === provider.name);

            return (
              <div
                key={provider.name}
                className="border border-white/10 rounded-lg overflow-hidden"
              >
                <button
                  type="button"
                  onClick={() => setExpanded(isOpen ? null : provider.name)}
                  className="w-full flex items-center justify-between px-4 py-3 bg-white/5 hover:bg-white/10 transition-colors text-left"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-white font-medium">
                      {provider.displayName || meta?.label || provider.name}
                    </span>
                    {provider.clientId && (
                      <span className="text-xs bg-green-500/20 text-green-300 px-1.5 py-0.5 rounded">
                        configured
                      </span>
                    )}
                  </div>
                  {isOpen ? (
                    <ChevronUpIcon className="h-4 w-4 text-gray-400" />
                  ) : (
                    <ChevronDownIcon className="h-4 w-4 text-gray-400" />
                  )}
                </button>

                {isOpen && (
                  <div className="p-4 space-y-3 border-t border-white/10">
                    <div>
                      <label className="block text-sm text-gray-300 mb-1">Display Name</label>
                      <input
                        type="text"
                        value={provider.displayName}
                        onChange={e => updateProvider(provider.name, 'displayName', e.target.value)}
                        className="w-full bg-black/30 border border-white/10 rounded px-3 py-2 text-white placeholder:text-gray-500 disabled:text-gray-400 disabled:bg-black/20"
                        placeholder={meta?.label || provider.name}
                        disabled={formDisabled}
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-sm text-gray-300 mb-1">Client ID</label>
                        <input
                          type="text"
                          value={provider.clientId}
                          onChange={e => updateProvider(provider.name, 'clientId', e.target.value)}
                          className="w-full bg-black/30 border border-white/10 rounded px-3 py-2 text-white placeholder:text-gray-500 disabled:text-gray-400 disabled:bg-black/20"
                          placeholder="Client ID"
                          disabled={formDisabled}
                        />
                      </div>
                      <div>
                        <label className="block text-sm text-gray-300 mb-1">
                          Client Secret
                          <span className="text-gray-500 ml-2 text-xs">Leave blank to keep current</span>
                        </label>
                        <input
                          type="password"
                          value={provider.clientSecret}
                          onChange={e => updateProvider(provider.name, 'clientSecret', e.target.value)}
                          className="w-full bg-black/30 border border-white/10 rounded px-3 py-2 text-white placeholder:text-gray-500 disabled:text-gray-400 disabled:bg-black/20"
                          placeholder="••••••••"
                          disabled={formDisabled}
                        />
                      </div>
                    </div>

                    {/* OIDC-specific endpoint fields */}
                    {isOIDC && (
                      <div className="space-y-3 border-t border-white/5 pt-3">
                        <p className="text-xs text-gray-400">
                          {meta?.hint && <span>{meta.hint} — </span>}
                          Enter your provider's OIDC endpoint URLs
                        </p>
                        <div>
                          <label className="block text-sm text-gray-300 mb-1">Authorization URL</label>
                          <input
                            type="url"
                            value={provider.authURL}
                            onChange={e => updateProvider(provider.name, 'authURL', e.target.value)}
                            className="w-full bg-black/30 border border-white/10 rounded px-3 py-2 text-white placeholder:text-gray-500 disabled:text-gray-400 disabled:bg-black/20"
                            placeholder="https://auth.example.com/api/oidc/authorization"
                            disabled={formDisabled}
                          />
                        </div>
                        <div>
                          <label className="block text-sm text-gray-300 mb-1">Token URL</label>
                          <input
                            type="url"
                            value={provider.tokenURL}
                            onChange={e => updateProvider(provider.name, 'tokenURL', e.target.value)}
                            className="w-full bg-black/30 border border-white/10 rounded px-3 py-2 text-white placeholder:text-gray-500 disabled:text-gray-400 disabled:bg-black/20"
                            placeholder="https://auth.example.com/api/oidc/token"
                            disabled={formDisabled}
                          />
                        </div>
                        <div>
                          <label className="block text-sm text-gray-300 mb-1">
                            User Info URL
                            <span className="text-gray-500 ml-2 text-xs">Optional if discovery is supported</span>
                          </label>
                          <input
                            type="url"
                            value={provider.userInfoURL}
                            onChange={e => updateProvider(provider.name, 'userInfoURL', e.target.value)}
                            className="w-full bg-black/30 border border-white/10 rounded px-3 py-2 text-white placeholder:text-gray-500 disabled:text-gray-400 disabled:bg-black/20"
                            placeholder="https://auth.example.com/api/oidc/userinfo"
                            disabled={formDisabled}
                          />
                        </div>
                      </div>
                    )}

                    <div className="flex justify-end pt-1">
                      <button
                        type="button"
                        onClick={() => removeProvider(provider.name)}
                        className="inline-flex items-center gap-1.5 text-sm text-red-400 hover:text-red-300 transition-colors"
                        disabled={formDisabled}
                      >
                        <TrashIcon className="h-4 w-4" />
                        Remove
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {/* Add provider dropdown */}
          {form.enabled && availableProviders.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm text-gray-400">Add provider:</span>
              {availableProviders.map(p => (
                <button
                  key={p.name}
                  type="button"
                  onClick={() => addProvider(p.name)}
                  className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded bg-white/5 border border-white/10 text-gray-300 hover:bg-white/10 hover:text-white transition-colors disabled:opacity-50"
                  disabled={formDisabled}
                >
                  <PlusIcon className="h-3.5 w-3.5" />
                  {p.label}
                </button>
              ))}
            </div>
          )}

          {/* Save */}
          <div className="flex justify-end pt-2">
            <button
              type="submit"
              className="px-4 py-2 rounded bg-white/10 text-white hover:bg-white/20 disabled:opacity-50 transition-colors"
              disabled={toggleDisabled}
            >
              {saving ? 'Saving...' : 'Save OAuth2'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
