import { useEffect, useState, type ReactNode } from 'react';
import {
  CodeBracketIcon,
  InformationCircleIcon,
  ServerStackIcon,
} from '@heroicons/react/24/outline';
import { pb } from '../../../lib/pocketbase';
import { Button, Card, cn, Input, SectionHeading, Switch } from '../../ui';

type RateLimitForm = {
  enabled: boolean;
  apiPerMinute: number;
  otherPerMinute: number;
};

type RateLimitDefaults = {
  apiPerMinute: number;
  otherPerMinute: number;
};

type RateLimitScopes = {
  api: string[];
  other: string[];
};

type RateLimitResponse = {
  rateLimits: RateLimitForm;
  defaults: RateLimitDefaults;
  scopes: RateLimitScopes;
};

const fallbackForm: RateLimitForm = {
  enabled: false,
  apiPerMinute: 600,
  otherPerMinute: 1200,
};

const fallbackDefaults: RateLimitDefaults = {
  apiPerMinute: 600,
  otherPerMinute: 1200,
};

const fallbackScopes: RateLimitScopes = {
  api: ['/api/v1/*'],
  other: ['/mcp', '/api/chat/*', '/api/export', '/docs', '/*'],
};

async function responseError(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  return body?.error || `${fallback} (${response.status})`;
}

interface ScopeCardProps {
  id: string;
  icon: ReactNode;
  label: string;
  caption: string;
  description: string;
  routes: string[];
  value: number;
  defaultValue: number;
  disabled: boolean;
  onChange: (value: number) => void;
}

function ScopeCard({
  id,
  icon,
  label,
  caption,
  description,
  routes,
  value,
  defaultValue,
  disabled,
  onChange,
}: ScopeCardProps) {
  return (
    <div className="rounded-control border border-line bg-surface-sunken px-4 py-3.5">
      <div className="flex flex-col gap-3.5 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-start gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[7px] border border-line bg-surface-sunken text-ink-muted [&>svg]:h-4 [&>svg]:w-4">
              {icon}
            </span>
            <div className="min-w-0">
              <label htmlFor={id} className="block text-[13.5px] font-medium leading-snug text-ink">
                {label}
              </label>
              <p className="mt-0.5 text-[11.5px] leading-relaxed text-ink-muted">{caption}</p>
            </div>
          </div>
          <p className="mt-2.5 text-xs leading-relaxed text-ink-secondary">{description}</p>
          <div className="mt-2 flex flex-wrap items-baseline gap-x-2.5 gap-y-1 text-[11px] leading-relaxed text-ink-muted">
            {routes.map((route) => (
              route === '/*'
                ? <span key={route}>everything else</span>
                : <span key={route} className="font-mono">{route}</span>
            ))}
          </div>
        </div>
        <div className="w-full shrink-0 sm:w-[9.75rem]">
          <div className="relative">
            <Input
              id={id}
              type="number"
              min={1}
              max={1_000_000}
              step={1}
              inputMode="numeric"
              value={value}
              onChange={(event) => onChange(Number(event.target.value))}
              disabled={disabled}
              required
              aria-describedby={`${id}-default`}
              className="pr-[4.4rem] text-right tabular-nums"
            />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-ink-muted">
              req/min
            </span>
          </div>
          <p id={`${id}-default`} className="mt-1.5 text-right text-[11px] text-ink-muted">
            Default {defaultValue.toLocaleString()}
          </p>
        </div>
      </div>
    </div>
  );
}

export function RateLimitSettings() {
  const [form, setForm] = useState<RateLimitForm>(fallbackForm);
  const [saved, setSaved] = useState<RateLimitForm | null>(null);
  const [defaults, setDefaults] = useState<RateLimitDefaults>(fallbackDefaults);
  const [scopes, setScopes] = useState<RateLimitScopes>(fallbackScopes);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const isAuthenticated = pb.authStore.isValid;

  const buildHeaders = (): HeadersInit => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const token = pb.authStore.token;
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
  };

  useEffect(() => {
    if (!isAuthenticated) {
      setError('Admin authentication required to manage rate limits.');
      setLoading(false);
      return;
    }

    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);
      setMessage(null);

      try {
        const response = await fetch('/api/v1/admin/rate-limits', { headers: buildHeaders() });
        if (!response.ok) {
          throw new Error(await responseError(response, 'Failed to load rate limits'));
        }

        const data = (await response.json()) as RateLimitResponse;
        if (cancelled) return;

        setForm(data.rateLimits);
        setSaved(data.rateLimits);
        setDefaults(data.defaults ?? fallbackDefaults);
        setScopes(data.scopes ?? fallbackScopes);
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : 'Failed to load rate limits');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated]);

  const updateForm = (patch: Partial<RateLimitForm>) => {
    setForm((previous) => ({ ...previous, ...patch }));
    setError(null);
    setMessage(null);
  };

  const dirty = saved !== null && (
    form.enabled !== saved.enabled ||
    form.apiPerMinute !== saved.apiPerMinute ||
    form.otherPerMinute !== saved.otherPerMinute
  );

  const disabled = !isAuthenticated || loading || saving || saved === null;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    const valid =
      Number.isInteger(form.apiPerMinute) &&
      form.apiPerMinute >= 1 &&
      form.apiPerMinute <= 1_000_000 &&
      Number.isInteger(form.otherPerMinute) &&
      form.otherPerMinute >= 1 &&
      form.otherPerMinute <= 1_000_000;

    if (!valid) {
      setError('Enter a whole number between 1 and 1,000,000 for each limit.');
      return;
    }

    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch('/api/v1/admin/rate-limits', {
        method: 'PATCH',
        headers: buildHeaders(),
        body: JSON.stringify(form),
      });
      if (!response.ok) {
        throw new Error(await responseError(response, 'Failed to save rate limits'));
      }

      const data = (await response.json()) as RateLimitResponse;
      setForm(data.rateLimits);
      setSaved(data.rateLimits);
      setDefaults(data.defaults ?? fallbackDefaults);
      setScopes(data.scopes ?? fallbackScopes);
      setMessage('Rate limits updated');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to save rate limits');
    } finally {
      setSaving(false);
    }
  };

  const summary = form.enabled
    ? `${form.apiPerMinute.toLocaleString()} API requests and ${form.otherPerMinute.toLocaleString()} other requests per minute, per IP.`
    : 'Rate limiting is off.';

  return (
    <Card className="flex flex-col p-5 sm:p-6">
      <SectionHeading
        eyebrow="Traffic"
        title="Rate limits"
        description="Per-IP request ceilings for the workspace API and every other surface."
      />

      <form className="mt-5 flex flex-1 flex-col gap-4" onSubmit={handleSubmit}>
        <Switch
          id="rate-limiting-enabled"
          label="Rate limiting"
          description={form.enabled
            ? 'Reject requests above the per-IP ceilings below.'
            : 'Leave off unless you need to slow abuse.'}
          checked={form.enabled}
          onChange={(enabled) => updateForm({ enabled })}
          disabled={disabled}
          className="rounded-control border border-line bg-surface-sunken px-3.5 py-3"
        />

        <div className="space-y-3">
          <ScopeCard
            id="rl-api"
            icon={<CodeBracketIcon />}
            label="Workspace API"
            caption="JSON API and browser facade"
            description="Notes, folders, boards, tasks, auth, files, realtime, and admin routes."
            routes={scopes.api}
            value={form.apiPerMinute}
            defaultValue={defaults.apiPerMinute}
            disabled={disabled}
            onChange={(apiPerMinute) => updateForm({ apiPerMinute })}
          />

          <ScopeCard
            id="rl-other"
            icon={<ServerStackIcon />}
            label="App and AI"
            caption="Everything outside /api/v1"
            description="MCP, chat, exports, the API reference, and the app shell."
            routes={scopes.other}
            value={form.otherPerMinute}
            defaultValue={defaults.otherPerMinute}
            disabled={disabled}
            onChange={(otherPerMinute) => updateForm({ otherPerMinute })}
          />
        </div>

        <div className="flex items-start gap-2.5 rounded-control border border-line bg-surface-sunken px-3.5 py-3">
          <InformationCircleIcon className="mt-0.5 h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />
          <p className="text-xs leading-relaxed text-ink-muted">
            Counters are per IP and live in memory. They reset when the server restarts and are not
            shared between replicas.
          </p>
        </div>

        <div className="mt-auto flex flex-wrap items-center justify-end gap-3 border-t border-line pt-4">
          <div className="mr-auto min-w-0">
            {error ? (
              <p role="alert" className="text-sm text-danger">{error}</p>
            ) : message ? (
              <p className="text-sm text-success">{message}</p>
            ) : (
              <p className={cn('text-sm', dirty ? 'text-ink-secondary' : 'text-ink-muted')}>
                {loading ? 'Loading rate limits…' : dirty ? 'Unsaved changes' : summary}
              </p>
            )}
          </div>
          <Button type="submit" variant="primary" loading={saving} disabled={disabled || !dirty}>
            Save rate limits
          </Button>
        </div>
      </form>
    </Card>
  );
}
