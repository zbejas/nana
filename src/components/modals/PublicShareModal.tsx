import { LinkIcon, GlobeAltIcon } from '@heroicons/react/24/outline';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Document } from '../../lib/documents';
import type { Folder } from '../../lib/folders';
import {
    fromDatetimeLocalValue,
    getDefaultPublicExpiryDate,
    getPublicDocumentUrl,
    getPublicFolderUrl,
    toDatetimeLocalValue,
    type PublicShareUpdateOptions,
} from '../../lib/public-sharing';

type PublicShareTarget =
    | { type: 'document'; record: Document }
    | { type: 'folder'; record: Folder };

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

    return target.type === 'document'
        ? getPublicDocumentUrl(target.record.public_share_token)
        : getPublicFolderUrl(target.record.public_share_token);
}

export function PublicShareModal({ target, isOpen, isSaving, onClose, onSave }: PublicShareModalProps) {
    const [publicEnabled, setPublicEnabled] = useState(false);
    const [expirationEnabled, setExpirationEnabled] = useState(true);
    const [expirationValue, setExpirationValue] = useState('');
    const [validationError, setValidationError] = useState<string | null>(null);

    useEffect(() => {
        if (!target) {
            return;
        }

        const hasExistingExpiry = Boolean(target.record.public_expires_at);
        const initialExpiry = hasExistingExpiry
            ? new Date(target.record.public_expires_at!)
            : getDefaultPublicExpiryDate();

        setPublicEnabled(true);
        setExpirationEnabled(hasExistingExpiry || !target.record.is_public);
        setExpirationValue(toDatetimeLocalValue(initialExpiry));
        setValidationError(null);
    }, [target]);

    const shareUrl = useMemo(() => getShareUrl(target), [target]);

    if (!isOpen || !target) {
        return null;
    }

    const handleCopyLink = async () => {
        if (!shareUrl) {
            return;
        }

        await navigator.clipboard.writeText(shareUrl);
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
        });
    };

    const title = target.type === 'document' ? target.record.title || 'Untitled' : target.record.name;

    return createPortal(
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/40 px-4 py-6 backdrop-blur-sm">
            <div className="w-full max-w-xl overflow-hidden rounded-2xl border border-white/15 bg-black/70 backdrop-blur-xl p-6 text-white shadow-2xl">
                <div>
                    <h2 className="text-2xl font-semibold">
                        {target.type === 'document' ? 'Share Document' : 'Share Folder'}
                    </h2>
                    <p className="mt-2 text-sm text-stone-300">{title}</p>
                </div>

                <div className="mt-6 space-y-5">
                    <label className="flex items-start justify-between gap-4 rounded-lg border border-white/10 bg-white/5 p-4">
                        <div>
                            <div className="flex items-center gap-2 text-sm font-medium text-white">
                                <GlobeAltIcon className="h-5 w-5 text-amber-300" />
                                Enable public access
                            </div>
                            <p className="mt-1 text-xs text-stone-300">
                                {target.type === 'document'
                                    ? 'Readers can open this note through a public read-only URL.'
                                    : 'Readers can browse this folder as a public read-only documentation site.'}
                            </p>
                        </div>

                        <input
                            type="checkbox"
                            checked={publicEnabled}
                            onChange={(event) => setPublicEnabled(event.target.checked)}
                            className="mt-1 h-5 w-5 rounded border-white/20 bg-transparent text-amber-400 focus:ring-amber-400"
                        />
                    </label>

                    <div className={`space-y-4 rounded-lg border p-4 ${publicEnabled ? 'border-white/10 bg-white/5' : 'border-white/5 bg-black/25 opacity-60'}`}>
                        <label className="flex items-start justify-between gap-4">
                            <div>
                                <div className="text-sm font-medium text-white">Expiration</div>
                                <p className="mt-1 text-xs text-stone-300">Enabled by default for new public links.</p>
                            </div>

                            <input
                                type="checkbox"
                                checked={expirationEnabled}
                                disabled={!publicEnabled}
                                onChange={(event) => setExpirationEnabled(event.target.checked)}
                                className="mt-1 h-5 w-5 rounded border-white/20 bg-transparent text-amber-400 focus:ring-amber-400"
                            />
                        </label>

                        <div>
                            <label className="mb-2 block text-xs uppercase tracking-[0.22em] text-stone-400">Expires At</label>
                            <input
                                type="datetime-local"
                                value={expirationValue}
                                disabled={!publicEnabled || !expirationEnabled}
                                onChange={(event) => setExpirationValue(event.target.value)}
                                className="w-full rounded-lg border border-white/10 bg-black/35 px-4 py-3 text-sm text-white outline-none transition-colors focus:border-amber-400/40"
                            />
                        </div>
                    </div>

                    {target.record.is_public && shareUrl && (
                        <div className="rounded-lg border border-amber-400/20 bg-amber-500/10 p-4">
                            <div className="flex items-center gap-2 text-sm font-medium text-amber-100">
                                <LinkIcon className="h-4 w-4" />
                                Public URL
                            </div>
                            <div className="mt-3 rounded-lg border border-white/10 bg-black/25 px-3 py-3 text-sm text-stone-100 break-all">
                                {shareUrl}
                            </div>
                            <div className="mt-3 flex flex-wrap gap-2">
                                <button
                                    type="button"
                                    onClick={() => { void handleCopyLink(); }}
                                    className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white transition-colors hover:bg-white/10"
                                >
                                    Copy Link
                                </button>
                                <a
                                    href={shareUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white transition-colors hover:bg-white/10"
                                >
                                    Open Public Page
                                </a>
                            </div>
                        </div>
                    )}

                    {validationError && <p className="text-sm text-red-300">{validationError}</p>}
                </div>

                <div className="mt-8 flex flex-wrap justify-end gap-3">
                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-stone-300 transition-colors hover:bg-white/10"
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={() => { void handleSubmit(); }}
                        disabled={isSaving}
                        className="rounded-lg border border-amber-400/30 bg-amber-500/15 px-4 py-2.5 text-sm font-medium text-amber-100 transition-colors hover:bg-amber-500/25 disabled:cursor-wait disabled:opacity-60"
                    >
                        {isSaving ? 'Saving...' : publicEnabled ? 'Save Sharing' : 'Disable Public Access'}
                    </button>
                </div>
            </div>
        </div>,
        document.body,
    );
}