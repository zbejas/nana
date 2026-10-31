import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckIcon,
  ClipboardDocumentIcon,
  KeyIcon,
  PlusIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import { XMarkIcon } from '@heroicons/react/20/solid';
import type {
  ApiKeyAccess,
  ApiKeyDto,
  ApiKeyScope,
} from '../../api/api-keys/types';
import {
  createApiKey,
  listApiKeys,
  revokeApiKey,
} from '../../lib/api-keys';
import type { Folder } from '../../lib/folders/types';
import { pb } from '../../lib/pocketbase';
import { useToasts } from '../../state/hooks';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  ConfirmDialog,
  EmptyState,
  Field,
  IconButton,
  Input,
  SectionHeading,
  SegmentedControl,
  Select,
  Spinner,
} from '../ui';

const ACCESS_OPTIONS: Array<{ value: ApiKeyAccess; label: string }> = [
  { value: 'read', label: 'Read only' },
  { value: 'write', label: 'Read and write' },
];

const SCOPE_OPTIONS: Array<{ value: ApiKeyScope; label: string }> = [
  { value: 'workspace', label: 'Entire workspace' },
  { value: 'root', label: 'Workspace root only' },
  { value: 'folders', label: 'Selected folders' },
];

const SCOPE_HINTS: Record<ApiKeyScope, string> = {
  workspace: 'Covers every folder and the workspace root. MCP still hides private records.',
  root: 'Covers only notes and boards at the workspace root. Folders and their contents are unavailable.',
  folders: 'Covers the selected folders and every folder inside them. The workspace root and other folders are unavailable.',
};

function formatDate(value: string): string {
  if (!value) return 'Unknown';
  const date = new Date(value.includes('T') ? value : value.replace(' ', 'T'));
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatLastUsed(value: string | null): string {
  return value ? `Last used ${formatDate(value)}` : 'Never used';
}

function scopeSummary(key: ApiKeyDto): string {
  if (key.scope === 'workspace') return 'Entire workspace';
  if (key.scope === 'root') return 'Root only';
  if (key.folders.length === 0) return 'No folders';
  if (key.folders.length === 1) return key.folders[0]?.name || '1 folder';
  return `${key.folders.length} folders`;
}

function folderPath(folder: Folder, byId: Map<string, Folder>, seen: Set<string>): string {
  const parentId = folder.parent;
  const parent = parentId ? byId.get(parentId) : undefined;
  if (!parent || seen.has(parent.id)) return folder.name;
  return `${folderPath(parent, byId, new Set([...seen, folder.id]))} / ${folder.name}`;
}

export function ApiKeysTab() {
  const { showToast } = useToasts();
  const nameRef = useRef<HTMLInputElement>(null);
  const foldersRequested = useRef(false);

  const [keys, setKeys] = useState<ApiKeyDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [created, setCreated] = useState<{ token: string; name: string } | null>(null);
  const [revoking, setRevoking] = useState<ApiKeyDto | null>(null);
  const [isRevoking, setIsRevoking] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [name, setName] = useState('');
  const [access, setAccess] = useState<ApiKeyAccess>('read');
  const [scope, setScope] = useState<ApiKeyScope>('workspace');
  const [selectedFolders, setSelectedFolders] = useState<Set<string>>(new Set());
  const [folders, setFolders] = useState<Folder[]>([]);
  const [foldersLoading, setFoldersLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setKeys(await listApiKeys());
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Could not load API keys.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!createOpen || foldersRequested.current) return;
    foldersRequested.current = true;

    setFoldersLoading(true);
    const userId = pb.authStore.record?.id;
    pb.collection<Folder>('folders')
      .getFullList({ sort: 'name' })
      // The facade can include folders shared with this user. Key scope is
      // owner-only, so keep the picker aligned with what the server accepts.
      .then((records) => setFolders(userId ? records.filter((folder) => folder.author === userId) : records))
      .catch(() => {
        foldersRequested.current = false;
        showToast('Could not load your folders', 'error');
      })
      .finally(() => setFoldersLoading(false));
  }, [createOpen, showToast]);

  const folderOptions = useMemo(() => {
    const byId = new Map(folders.map((folder) => [folder.id, folder]));
    return folders
      .map((folder) => ({
        id: folder.id,
        label: folderPath(folder, byId, new Set([folder.id])),
        isPrivate: folder.is_private === true,
      }))
      .sort((left, right) => left.label.localeCompare(right.label));
  }, [folders]);

  const openCreate = () => {
    setName('');
    setAccess('read');
    setScope('workspace');
    setSelectedFolders(new Set());
    setFormError(null);
    setCopied(false);
    setCreateOpen(true);
    window.requestAnimationFrame(() => nameRef.current?.focus({ preventScroll: true }));
  };

  const toggleFolder = (id: string) => {
    setSelectedFolders((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleCreate = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setFormError('Give the key a name so you can recognize it later.');
      nameRef.current?.focus();
      return;
    }
    if (scope === 'folders' && selectedFolders.size === 0) {
      setFormError('Choose at least one folder for this key.');
      return;
    }

    setFormError(null);
    setIsSubmitting(true);
    try {
      const result = await createApiKey({
        name: trimmed,
        access,
        scope,
        folderIds: scope === 'folders' ? [...selectedFolders] : [],
      });
      setKeys((current) => [result.apiKey, ...current]);
      setCreateOpen(false);
      setCreated({ token: result.token, name: result.apiKey.name });
      showToast('API key created', 'success');
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Could not create the API key.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const closeCreated = () => {
    setCreated(null);
    setCopied(false);
  };

  const copyToken = async () => {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.token);
      setCopied(true);
      showToast('API key copied', 'success');
    } catch {
      showToast('Could not copy the key. Select it and copy manually.', 'error');
    }
  };

  const handleRevoke = async () => {
    if (!revoking) return;
    setIsRevoking(true);
    try {
      await revokeApiKey(revoking.id);
      setKeys((current) => current.filter((key) => key.id !== revoking.id));
      setRevoking(null);
      showToast('API key revoked', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not revoke the API key.', 'error');
    } finally {
      setIsRevoking(false);
    }
  };

  return (
    <div className="space-y-5">
      <Card className="p-5 sm:p-6">
        <SectionHeading
          title="API keys"
          description="Long-lived credentials for the workspace API and MCP. Nana stores only a hash after creation, so copy a new key before dismissing it."
          actions={
            <Button
              variant={createOpen ? 'secondary' : 'primary'}
              icon={<PlusIcon />}
              onClick={() => {
                if (createOpen) {
                  setCreateOpen(false);
                  setFormError(null);
                } else {
                  openCreate();
                }
              }}
              aria-expanded={createOpen}
            >
              {createOpen ? 'Close' : 'Create key'}
            </Button>
          }
        />

        {createOpen && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void handleCreate();
            }}
            className="animate-slideDown mt-5 space-y-4 border-t border-line pt-5"
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Key name" htmlFor="api-key-name">
                <Input
                  id="api-key-name"
                  ref={nameRef}
                  value={name}
                  maxLength={80}
                  placeholder="Claude Desktop"
                  onChange={(event) => {
                    setName(event.target.value);
                    if (formError && event.target.value.trim()) setFormError(null);
                  }}
                  autoComplete="off"
                />
              </Field>

              <Field label="Scope" htmlFor="api-key-scope" hint={SCOPE_HINTS[scope]}>
                <Select
                  id="api-key-scope"
                  value={scope}
                  onChange={(event) => setScope(event.target.value as ApiKeyScope)}
                >
                  {SCOPE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            <Field label="Access" hint="Read-only keys cannot create, update, move, archive, or delete anything.">
              <SegmentedControl
                label="Key access"
                value={access}
                onChange={(next) => setAccess(next as ApiKeyAccess)}
                options={ACCESS_OPTIONS}
              />
            </Field>

            {scope === 'folders' && (
              <div className="space-y-2">
                <p className="text-[12.5px] font-medium text-ink">Folders</p>
                {foldersLoading ? (
                  <div className="flex items-center justify-center rounded-control border border-line bg-surface-sunken py-8">
                    <Spinner label="Loading folders" />
                  </div>
                ) : folderOptions.length === 0 ? (
                  <p className="rounded-control border border-line bg-surface-sunken px-3.5 py-3 text-xs text-ink-muted">
                    You have no folders yet. Choose another scope, or create a folder first.
                  </p>
                ) : (
                  <div className="max-h-64 space-y-1 overflow-y-auto rounded-control border border-line bg-surface-sunken p-1.5 scrollbar-autohide">
                    {folderOptions.map((folder) => (
                      <Checkbox
                        key={folder.id}
                        id={`api-key-folder-${folder.id}`}
                        checked={selectedFolders.has(folder.id)}
                        onChange={() => toggleFolder(folder.id)}
                        label={folder.label}
                        description={folder.isPrivate ? 'Private folders stay hidden from MCP.' : undefined}
                      />
                    ))}
                  </div>
                )}
                <p className="text-xs text-ink-muted">
                  Selecting a folder includes every folder inside it. The workspace root is not included.
                </p>
              </div>
            )}

            {formError && (
              <p className="text-[12.5px] leading-relaxed text-danger" role="alert">
                {formError}
              </p>
            )}

            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button
                variant="secondary"
                onClick={() => {
                  setCreateOpen(false);
                  setFormError(null);
                }}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
              <Button type="submit" variant="primary" loading={isSubmitting}>
                Create key
              </Button>
            </div>
          </form>
        )}

        {created && (
          <div
            className="animate-slideDown mt-5 rounded-control border border-signal/25 bg-signal-soft/60 p-4"
            role="status"
          >
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-ink">Copy your key now</p>
                <p className="mt-1 max-w-[62ch] text-[12px] leading-relaxed text-ink-secondary">
                  This is the only time Nana can show the full key. Store it in the client that will use
                  it; if you lose it, revoke it and create another.
                </p>
              </div>
              <IconButton label="Dismiss new key" size="sm" onClick={closeCreated} className="-mr-1 -mt-1">
                <XMarkIcon />
              </IconButton>
            </div>
            <div className="mt-3 rounded-control border border-line bg-surface px-3.5 py-3">
              <code className="block break-all font-mono text-[12.5px] leading-relaxed text-ink">
                {created.token}
              </code>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Button
                variant="secondary"
                size="sm"
                icon={copied ? <CheckIcon /> : <ClipboardDocumentIcon />}
                onClick={() => void copyToken()}
              >
                {copied ? 'Copied' : 'Copy key'}
              </Button>
              <span className="text-xs text-ink-muted">For {created.name}</span>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-ink-muted">
              Send it as <code className="font-mono text-ink-secondary">Authorization: Bearer nana_…</code> to{' '}
              <code className="font-mono text-ink-secondary">/mcp</code> or the typed{' '}
              <code className="font-mono text-ink-secondary">/api/v1</code> workspace API.
            </p>
          </div>
        )}

        <div className="mt-5 border-t border-line">
          {loading ? (
            <div className="flex items-center justify-center py-10">
              <Spinner label="Loading API keys" />
            </div>
          ) : loadError ? (
            <div className="flex flex-wrap items-center justify-between gap-3 py-5">
              <p className="text-sm text-danger">{loadError}</p>
              <Button variant="secondary" size="sm" onClick={() => void load()}>
                Try again
              </Button>
            </div>
          ) : keys.length === 0 ? (
            <EmptyState
              compact
              title="No API keys yet"
              description="Create a key to connect an MCP client or another machine without storing a password."
              action={
                <Button variant="secondary" icon={<KeyIcon />} onClick={openCreate}>
                  Create your first key
                </Button>
              }
            />
          ) : (
            <ul className="divide-y divide-line">
              {keys.map((key) => (
                <li key={key.id} className="flex flex-wrap items-start justify-between gap-4 py-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-ink">{key.name}</span>
                      <Badge tone={key.access === 'read' ? 'neutral' : 'warning'}>
                        {key.access === 'read' ? 'Read only' : 'Read and write'}
                      </Badge>
                      <Badge tone="outline">{scopeSummary(key)}</Badge>
                    </div>
                    <p className="mt-1.5 font-mono text-[12px] text-ink-muted">{key.prefix}…</p>
                    <p className="mt-1 text-xs text-ink-muted">
                      {formatLastUsed(key.lastUsedAt)} · Created {formatDate(key.createdAt)}
                    </p>
                    {key.scope === 'folders' && key.folders.length > 0 && (
                      <p className="mt-1.5 max-w-[65ch] text-xs leading-relaxed text-ink-muted">
                        {key.folders.map((folder) => folder.name).join(', ')}
                      </p>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<TrashIcon />}
                    className="text-danger hover:bg-danger-soft hover:text-danger"
                    onClick={() => setRevoking(key)}
                  >
                    Revoke
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      <Card className="p-5 sm:p-6">
        <SectionHeading
          title="Connecting a client"
          description="Use a key anywhere a Nana token is accepted on the workspace API or MCP. Send it as a Bearer token; the browser session is not affected."
        />
        <div className="mt-4 rounded-control border border-line bg-surface-sunken px-3.5 py-3">
          <p className="font-mono text-[12px] leading-relaxed text-ink-secondary">
            POST /mcp<br />
            Authorization: Bearer nana_…
          </p>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-ink-muted">
          Keys are limited to the typed workspace API and MCP. They cannot sign in to the web app, open files, or manage other keys. Private notes, boards, and folders stay hidden from MCP regardless of scope.
        </p>
      </Card>

      <ConfirmDialog
        open={revoking !== null}
        title="Revoke API key?"
        description={
          revoking
            ? `“${revoking.name}” will stop working immediately. This cannot be undone.`
            : undefined
        }
        confirmLabel="Revoke key"
        tone="danger"
        busy={isRevoking}
        onCancel={() => setRevoking(null)}
        onConfirm={() => void handleRevoke()}
      />
    </div>
  );
}
