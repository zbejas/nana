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
        return <DocumentTextIcon className="h-4 w-4 text-red-400" />;
    }

    if (isTextFile(filename)) {
        return <DocumentTextIcon className="h-4 w-4 text-blue-400" />;
    }

    return <DocumentIcon className="h-4 w-4 text-gray-400" />;
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
                        className="group public-attachment-item flex items-center gap-3 rounded-2xl border border-white/10 bg-black/20 px-3 py-3 text-sm text-stone-200 transition-colors hover:bg-white/10"
                    >
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded bg-gray-700">
                            <AttachmentPreview filename={filename} url={url} />
                        </div>
                        <div className="min-w-0 flex-1">
                            <p className="truncate text-sm text-stone-100 group-hover:text-white">{displayName}</p>
                        </div>
                    </a>
                );
            })}
        </div>
    );
}

export default PublicAttachmentList;