import { LinkIcon } from '@heroicons/react/24/outline';
import { DateTimePicker } from './DateTimePicker';
import { useEffect, useMemo, useRef, useState } from 'react';
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
    type PublicShareUpdateOptions,
} from '../../lib/public-sharing';
import { Button, Dialog, Switch } from '../ui';

type PublicShareTarget =
    | { type: 'document'; record: Document }
    | { type: 'folder'; record: Folder }
    | { type: 'board'; record: Board };

interface PublicShareModalProps {
    target: PublicShareTarget | null;
    isOpen: boolean;
    isSaving: boolean;
    onClose: () => void;
    onSave: (options: PublicShareUpdateOptions) => Promise<unknown>;
}

function getShareUrl(target: PublicShareTarget | null) {
    if (!target?.record.public_share_token) {
        return '';
    }

    if (target.type === 'document') {
        return getPublicDocumentUrl(target.record.public_share_token);
    }

    if (target.type === 'folder') {
        return getPublicFolderUrl(target.record.public_share_token);
    }

    return getPublicBoardUrl(target.record.public_share_token);
}

export function PublicShareModal({ target, isOpen, isSaving, onClose, onSave }: PublicShareModalProps) {
    const [publicEnabled, setPublicEnabled] = useState(false);
    const [isPrivate, setIsPrivate] = useState(false);
    const [shareAttachments, setShareAttachments] = useState(false);
    const [expirationEnabled, setExpirationEnabled] = useState(true);
    const [expirationValue, setExpirationValue] = useState('');
    const [validationError, setValidationError] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);
    const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        if (!target) return;

        const hasExistingExpiry = Boolean(target.record.public_expires_at);
        const initialExpiry = hasExistingExpiry
            ? new Date(target.record.public_expires_at!)
            : getDefaultPublicExpiryDate();

        setPublicEnabled(target.record.is_public ?? false);
        setIsPrivate(target.record.is_private ?? false);
        setShareAttachments(
            target.type === 'board' ? false : target.record.share_attachments ?? false
        );
        setExpirationEnabled(hasExistingExpiry || !target.record.is_public);
        setExpirationValue(toDatetimeLocalValue(initialExpiry));
        setValidationError(null);
        setCopied(false);
    }, [target]);

    const shareUrl = useMemo(() => getShareUrl(target), [target]);

    if (!isOpen || !target) {
        return null;
    }

    const handleCopyLink = async () => {
        if (!shareUrl) return;

        await navigator.clipboard.writeText(shareUrl);
        setCopied(true);
        if (copiedTimer.current) {
            clearTimeout(copiedTimer.current);
        }
        copiedTimer.current = setTimeout(() => setCopied(false), 2000);
    };

    const handleSubmit = async () => {
        const parsedExpiration = expirationEnabled ? fromDatetimeLocalValue(expirationValue) : null;

        if (publicEnabled && expirationEnabled && !parsedExpiration) {
            setValidationError('Pick a valid expiration date and time.');
            return;
        }

        if (publicEnabled && parsedExpiration && parsedExpiration.getTime() <= Date.now()) {
            setValidationError('Expiration must be in the future.');
            return;
        }

        setValidationError(null);

        await onSave({
            enabled: publicEnabled,
            expiresAt: publicEnabled && expirationEnabled && parsedExpiration
                ? parsedExpiration.toISOString()
                : null,
            isPrivate,
            shareAttachments,
        });
    };

    const title = target.type === 'document' ? target.record.title || 'Untitled' : target.record.name;
    const kind = target.type === 'document' ? 'note' : target.type === 'folder' ? 'folder' : 'board';
    const publicDescription =
        target.type === 'document'
            ? 'Anyone with the link can read this note. No sign-in required.'
            : target.type === 'folder'
                ? 'Anyone with the link can browse this folder as a read-only site.'
                : 'Anyone with the link can read this board and its tasks. No sign-in required.';
    const privateDescription =
        target.type === 'document'
            ? 'Hidden from AI chat and MCP. It also stays out of shared parents and can still be opened here.'
            : target.type === 'folder'
                ? 'Hidden from AI chat and MCP. It also hides everything inside it from shared parents and can still be opened here.'
                : 'Hidden from AI chat and MCP. A private board cannot be shared publicly and can still be opened here.';

    return (
        <Dialog
            open
            onClose={onClose}
            eyebrow="Public sharing"
            title={`Share this ${kind}`}
            description={title}
            size="lg"
            footer={
                <>
                    <Button variant="secondary" onClick={onClose} disabled={isSaving}>
                        Cancel
                    </Button>
                    <Button variant="primary" onClick={() => void handleSubmit()} loading={isSaving}>
                        Save sharing
                    </Button>
                </>
            }
        >
            <div className="space-y-3">
                <Switch
                    label="Public access"
                    description={publicDescription}
                    checked={publicEnabled}
                    onChange={setPublicEnabled}
                    disabled={isPrivate}
                />

                {publicEnabled && !isPrivate && (
                    <div className="animate-slideDown space-y-4 rounded-control border border-line bg-surface-sunken/50 p-4">
                        <Switch
                            label="Set an expiry"
                            description="Links close automatically after this date."
                            checked={expirationEnabled}
                            onChange={setExpirationEnabled}
                        />
                        {expirationEnabled && (
                            <div>
                                <p className="eyebrow mb-2">Expires at</p>
                                <DateTimePicker value={expirationValue} onChange={setExpirationValue} />
                            </div>
                        )}
                    </div>
                )}

                <Switch
                    label="Private"
                    description={privateDescription}
                    checked={isPrivate}
                    onChange={(next) => {
                        setIsPrivate(next);
                        if (next) {
                            setPublicEnabled(false);
                        }
                    }}
                />

                {target.type !== 'board' && (
                    <Switch
                        label="Share attachments"
                        description={
                            target.type === 'document'
                                ? 'Let public readers download the files attached to this note.'
                                : 'Let public readers download attachments from notes in this folder.'
                        }
                        checked={shareAttachments}
                        onChange={setShareAttachments}
                        disabled={isPrivate}
                    />
                )}

                {target.record.is_public && shareUrl && (
                    <div className="rounded-control border border-signal/20 bg-signal-soft/60 p-4">
                        <div className="flex items-center gap-2 text-sm font-medium text-signal">
                            <LinkIcon className="h-4 w-4" />
                            Public URL
                        </div>
                        <div className="mt-2.5 break-all rounded-[6px] border border-line bg-surface-sunken px-3 py-2.5 font-mono text-[12px] text-ink-secondary">
                            {shareUrl}
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                            <Button variant="secondary" size="sm" onClick={() => void handleCopyLink()}>
                                {copied ? 'Copied' : 'Copy link'}
                            </Button>
                            <a href={shareUrl} target="_blank" rel="noreferrer">
                                <Button variant="ghost" size="sm">
                                    Open public page
                                </Button>
                            </a>
                        </div>
                    </div>
                )}

                {validationError && <p className="text-sm text-danger">{validationError}</p>}
            </div>
        </Dialog>
    );
}
