import { DocumentIcon, DocumentTextIcon } from '@heroicons/react/24/outline';
import { getOriginalFilename, isImageFile, isPdfFile, isTextFile } from '../../lib/documents';

interface PublicAttachmentListProps {
    attachments: string[];
    getAttachmentUrl: (filename: string) => string;
}

function AttachmentPreview({ filename, url }: { filename: string; url: string }) {
    if (isImageFile(filename)) {
        return (
            <img
                src={url}
                alt={getOriginalFilename(filename)}
                className="h-full w-full object-cover"
                loading="lazy"
            />
        );
    }

    if (isPdfFile(filename)) {
        return <DocumentTextIcon className="h-4 w-4 text-danger" />;
    }

    if (isTextFile(filename)) {
        return <DocumentTextIcon className="h-4 w-4 text-ember" />;
    }

    return <DocumentIcon className="h-4 w-4 text-ink-muted" />;
}

export function PublicAttachmentList({ attachments, getAttachmentUrl }: PublicAttachmentListProps) {
    return (
        <div className="flex flex-col gap-3">
            {attachments.map((filename, index) => {
                const url = getAttachmentUrl(filename);
                const displayName = getOriginalFilename(filename);

                return (
                    <a
                        key={filename}
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                        style={{ animationDelay: `${index * 40}ms` }}
                        className="group public-attachment-item flex items-center gap-3 rounded-panel border border-line bg-surface px-3 py-3 text-sm text-ink-muted transition-colors hover:bg-surface hover:border-brass/30"
                    >
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded bg-surface">
                            <AttachmentPreview filename={filename} url={url} />
                        </div>
                        <div className="min-w-0 flex-1">
                            <p className="truncate text-sm text-ink-muted group-hover:text-ink">{displayName}</p>
                        </div>
                    </a>
                );
            })}
        </div>
    );
}

export default PublicAttachmentList;