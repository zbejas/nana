import { useEffect, useMemo, useRef, useState } from 'react';
import { LinkIcon } from '@heroicons/react/24/outline';
import type { Board } from '../../lib/boards';
import type { Document } from '../../lib/documents';
import type { Folder } from '../../lib/folders';
import {
  fromDatetimeLocalValue,
  getDefaultPublicExpiryDate,
  getPublicBoardUrl,
  getPublicDocumentUrl,
  getPublicFolderUrl,
  toDatetimeLocalValue,
  updateBoardPublicShare,
  updateDocumentPublicShare,
  updateFolderPublicShare,
  type PublicShareUpdateOptions,
} from '../../lib/public-sharing';
import { useToasts } from '../../state/hooks';
import { Button, Switch } from '../ui';
import { DateTimePicker } from '../modals/DateTimePicker';

export type PublicShareSectionTarget =
  | { type: 'document'; record: Document }
  | { type: 'folder'; record: Folder }
  | { type: 'board'; record: Board };

interface PublicShareSectionProps {
  target: PublicShareSectionTarget;
  onSaved?: (target: PublicShareSectionTarget) => void;
  onChanged?: () => void;
}

interface PublicShareDraft {
  publicEnabled: boolean;
  isPrivate: boolean;
  shareAttachments: boolean;
  expirationEnabled: boolean;
  expirationValue: string;
}

function draftFrom(target: PublicShareSectionTarget): PublicShareDraft {
  const record = target.record;
  const hasExistingExpiry = Boolean(record.public_expires_at);
  const initialExpiry = hasExistingExpiry
    ? new Date(record.public_expires_at as string)
    : getDefaultPublicExpiryDate();

  return {
    publicEnabled: Boolean(record.is_public) && !record.is_private,
    isPrivate: Boolean(record.is_private),
    shareAttachments:
      target.type === 'board' ? false : Boolean(target.record.share_attachments),
    expirationEnabled: hasExistingExpiry || !record.is_public,
    expirationValue: toDatetimeLocalValue(initialExpiry),
  };
}

function sectionSignature(target: PublicShareSectionTarget): string {
  const record = target.record;
  return [
    target.type,
    record.id,
    record.updated,
    record.is_public,
    record.is_private,
    record.public_share_token,
    record.public_expires_at,
    target.type === 'board' ? '' : target.record.share_attachments,
  ].join(':');
}

function publicShareUrl(target: PublicShareSectionTarget): string {
  const token = target.record.public_share_token;
  if (!token) return '';
  if (target.type === 'document') return getPublicDocumentUrl(token);
  if (target.type === 'folder') return getPublicFolderUrl(token);
  return getPublicBoardUrl(token);
}

function publicDescription(type: PublicShareSectionTarget['type']): string {
  if (type === 'document') return 'Anyone with the link can read this note. No sign-in required.';
  if (type === 'folder') return 'Anyone with the link can browse this folder as a read-only site.';
  return 'Anyone with the link can read this board and its tasks. No sign-in required.';
}

function privateDescription(type: PublicShareSectionTarget['type']): string {
  if (type === 'document') {
    return 'Hidden from AI chat and MCP. It also stays out of shared parents and can still be opened here.';
  }
  if (type === 'folder') {
    return 'Hidden from AI chat and MCP. It also hides everything inside it from shared parents and can still be opened here.';
  }
  return 'Hidden from AI chat and MCP. A private board cannot be shared publicly and can still be opened here.';
}

/**
 * The public-link half of the share panel. It renders as a section inside the
 * one SidePanel, so a record has one share surface rather than a second panel.
 * Public-link fields keep their explicit save; the Private switch saves itself
 * immediately so closing the panel cannot silently discard a privacy change.
 */
export function PublicShareSection({ target, onSaved, onChanged }: PublicShareSectionProps) {
  const { showToast } = useToasts();
  const [draft, setDraft] = useState<PublicShareDraft>(() => draftFrom(target));
  const [baseline, setBaseline] = useState<PublicShareDraft>(() => draftFrom(target));
  const [saving, setSaving] = useState(false);
  const [privacySaving, setPrivacySaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const signature = sectionSignature(target);

  useEffect(() => {
    const next = draftFrom(target);
    setDraft(next);
    setBaseline(next);
    setError(null);
    // Reset only when the saved record identity or sharing fields change.
  }, [signature]);

  useEffect(() => {
    return () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    };
  }, []);

  const shareUrl = useMemo(() => publicShareUrl(target), [target]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);
  const controlsDisabled = saving || privacySaving;

  const handleCopyLink = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      showToast('Could not copy the public link', 'error');
    }
  };

  const saveOptions = async (options: PublicShareUpdateOptions): Promise<PublicShareSectionTarget> => {
    if (target.type === 'document') {
      return { type: 'document', record: await updateDocumentPublicShare(target.record, options) };
    }
    if (target.type === 'folder') {
      return { type: 'folder', record: await updateFolderPublicShare(target.record, options) };
    }
    return { type: 'board', record: await updateBoardPublicShare(target.record, options) };
  };

  const handleSave = async () => {
    if (!dirty || controlsDisabled) return;

    const parsedExpiration = draft.expirationEnabled
      ? fromDatetimeLocalValue(draft.expirationValue)
      : null;

    if (draft.publicEnabled && draft.expirationEnabled && !parsedExpiration) {
      setError('Pick a valid expiration date and time.');
      return;
    }
    if (draft.publicEnabled && parsedExpiration && parsedExpiration.getTime() <= Date.now()) {
      setError('Expiration must be in the future.');
      return;
    }

    const options: PublicShareUpdateOptions = {
      enabled: draft.publicEnabled,
      expiresAt:
        draft.publicEnabled && draft.expirationEnabled && parsedExpiration
          ? parsedExpiration.toISOString()
          : null,
      isPrivate: draft.isPrivate,
      shareAttachments: draft.shareAttachments,
    };

    setSaving(true);
    setError(null);

    try {
      const updated = await saveOptions(options);

      setBaseline(draft);
      onSaved?.(updated);
      onChanged?.();
      showToast(
        draft.publicEnabled ? 'Public link updated' : 'Public link turned off',
        'success'
      );
    } catch {
      setError('Could not update the public link. Try again.');
      showToast('Could not update the public link', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handlePrivateChange = async (next: boolean) => {
    if (next === draft.isPrivate || controlsDisabled) return;

    const nextDraft: PublicShareDraft = {
      ...draft,
      isPrivate: next,
      publicEnabled: next ? false : draft.publicEnabled,
      shareAttachments: next ? false : draft.shareAttachments,
    };
    const parsedExpiration = nextDraft.expirationEnabled
      ? fromDatetimeLocalValue(nextDraft.expirationValue)
      : null;
    const options: PublicShareUpdateOptions = {
      enabled: nextDraft.publicEnabled,
      expiresAt:
        nextDraft.publicEnabled && nextDraft.expirationEnabled && parsedExpiration
          ? parsedExpiration.toISOString()
          : null,
      isPrivate: next,
      shareAttachments: nextDraft.shareAttachments,
    };

    const previousDraft = draft;
    setDraft(nextDraft);
    setPrivacySaving(true);
    setError(null);

    try {
      const updated = await saveOptions(options);
      setBaseline(nextDraft);
      onSaved?.(updated);
      onChanged?.();
      showToast(next ? 'Private turned on' : 'Private turned off', 'success');
    } catch {
      setDraft(previousDraft);
      setError(next ? 'Could not turn on privacy. Try again.' : 'Could not turn off privacy. Try again.');
      showToast('Could not update privacy', 'error');
    } finally {
      setPrivacySaving(false);
    }
  };

  const publicDisabled = controlsDisabled || draft.isPrivate;

  return (
    <section className="space-y-4" aria-labelledby="public-share-heading">
      <div>
        <h3
          id="public-share-heading"
          className="text-[13.5px] font-semibold tracking-[-0.01em] text-ink"
        >
          Public link
        </h3>
        <p className="mt-1 text-[12px] leading-relaxed text-ink-muted">
          The link works without an account. People sharing inside Nana use the list above.
        </p>
      </div>

      <Switch
        label="Public access"
        description={publicDescription(target.type)}
        checked={draft.publicEnabled}
        onChange={(next) => setDraft((current) => ({ ...current, publicEnabled: next }))}
        disabled={publicDisabled}
      />

      {draft.isPrivate && (
        <p className="rounded-control border border-warning/25 bg-warning-soft px-3 py-2.5 text-[12px] leading-relaxed text-warning">
          Private is on. Turn it off below before creating a public link or inviting people.
        </p>
      )}

      {draft.publicEnabled && !draft.isPrivate && (
        <div className="animate-slideDown space-y-4 rounded-control border border-line bg-surface-sunken/50 p-3.5">
          <Switch
            label="Set an expiry"
            description="Links close automatically after this date."
            checked={draft.expirationEnabled}
            onChange={(next) =>
              setDraft((current) => ({ ...current, expirationEnabled: next }))
            }
            disabled={controlsDisabled}
          />
          {draft.expirationEnabled && (
            <div>
              <p className="eyebrow mb-2">Expires at</p>
              <DateTimePicker
                value={draft.expirationValue}
                disabled={controlsDisabled}
                onChange={(value) =>
                  setDraft((current) => ({ ...current, expirationValue: value }))
                }
              />
            </div>
          )}

          {shareUrl ? (
            <div className="rounded-control border border-signal/20 bg-signal-soft/60 p-3.5">
              <div className="flex items-center gap-2 text-[12.5px] font-medium text-signal">
                <LinkIcon className="h-4 w-4" aria-hidden="true" />
                Public URL
              </div>
              <div className="mt-2 break-all rounded-[6px] border border-line bg-surface-sunken px-2.5 py-2 font-mono text-[11.5px] text-ink-secondary">
                {shareUrl}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  className="h-11 sm:h-8"
                  onClick={() => void handleCopyLink()}
                >
                  {copied ? 'Copied' : 'Copy link'}
                </Button>
                <a href={shareUrl} target="_blank" rel="noreferrer">
                  <Button variant="ghost" size="sm" className="h-11 sm:h-8">
                    Open public page
                  </Button>
                </a>
              </div>
            </div>
          ) : (
            <p className="text-[12px] leading-relaxed text-ink-muted">
              Save to create the public link.
            </p>
          )}
        </div>
      )}

      <Switch
        label="Private"
        description={privateDescription(target.type)}
        checked={draft.isPrivate}
        onChange={(next) => void handlePrivateChange(next)}
        disabled={controlsDisabled}
      />

      {target.type !== 'board' && (
        <Switch
          label="Share attachments"
          description={
            target.type === 'document'
              ? 'Let public readers download the files attached to this note.'
              : 'Let public readers download attachments from notes in this folder.'
          }
          checked={draft.shareAttachments}
          onChange={(next) =>
            setDraft((current) => ({ ...current, shareAttachments: next }))
          }
          disabled={publicDisabled}
        />
      )}

      {error && (
        <p role="alert" className="text-[12px] leading-relaxed text-danger">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line pt-3">
        {dirty && (
          <Button
            variant="ghost"
            size="sm"
            className="h-11 sm:h-8"
            onClick={() => {
              setDraft(baseline);
              setError(null);
            }}
            disabled={controlsDisabled}
          >
            Discard
          </Button>
        )}
        <Button
          variant="secondary"
          size="sm"
          className="h-11 sm:h-8"
          onClick={() => void handleSave()}
          loading={saving}
          disabled={!dirty || controlsDisabled}
        >
          Save link settings
        </Button>
      </div>
    </section>
  );
}
