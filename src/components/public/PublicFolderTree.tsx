import { ChevronDownIcon, ChevronRightIcon, DocumentTextIcon, FolderIcon } from '@heroicons/react/24/outline';
import { useState } from 'react';
import type { Document } from '../../lib/documents';
import type { FolderTreeNode } from '../../lib/folders';

interface PublicFolderTreeProps {
    nodes: FolderTreeNode[];
    documentsByFolderId: Map<string, Document[]>;
    selectedDocumentId: string | null;
    onSelectDocument: (documentId: string) => void;
    rootFolderId: string;
}

function PublicFolderBranch({
    node,
    documentsByFolderId,
    selectedDocumentId,
    onSelectDocument,
}: {
    node: FolderTreeNode;
    documentsByFolderId: Map<string, Document[]>;
    selectedDocumentId: string | null;
    onSelectDocument: (documentId: string) => void;
}) {
    const [expanded, setExpanded] = useState(true);
    const documents = documentsByFolderId.get(node.id) || [];
    const hasChildren = node.subfolders.length > 0 || documents.length > 0;

    return (
        <div className="space-y-2">
            <button
                type="button"
                onClick={() => setExpanded((current) => !current)}
                className="flex w-full items-center gap-2 rounded-control px-2 py-2 text-left text-sm text-ink-secondary transition-colors hover:bg-surface-raised"
            >
                {hasChildren ? (
                    expanded ? <ChevronDownIcon className="h-4 w-4 text-ink-muted" /> : <ChevronRightIcon className="h-4 w-4 text-ink-muted" />
                ) : (
                    <span className="h-4 w-4" />
                )}
                <FolderIcon className="h-4 w-4 text-ink-muted" />
                <span className="truncate">{node.name}</span>
            </button>

            {expanded && (
                <div className="ml-5 space-y-1 border-l border-line pl-3">
                    {documents.map((document) => {
                        const isSelected = selectedDocumentId === document.id;

                        return (
                            <button
                                key={document.id}
                                type="button"
                                onClick={() => onSelectDocument(document.id)}
                                className={`flex w-full items-center gap-2 rounded-control px-2 py-2 text-left text-sm transition-colors ${
                                    isSelected
                                        ? 'bg-signal-soft text-ink ring-1 ring-signal/35'
                                        : 'text-ink-muted hover:bg-surface-raised hover:text-ink'
                                }`}
                            >
                                <DocumentTextIcon className="h-4 w-4 shrink-0" />
                                <span className="truncate">{document.title || 'Untitled'}</span>
                            </button>
                        );
                    })}

                    {node.subfolders.map((child) => (
                        <PublicFolderBranch
                            key={child.id}
                            node={child}
                            documentsByFolderId={documentsByFolderId}
                            selectedDocumentId={selectedDocumentId}
                            onSelectDocument={onSelectDocument}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

export function PublicFolderTree({
    nodes,
    documentsByFolderId,
    selectedDocumentId,
    onSelectDocument,
    rootFolderId,
}: PublicFolderTreeProps) {
    const rootNode = nodes.find((node) => node.id === rootFolderId) || nodes[0];

    if (!rootNode) {
        return null;
    }

    return (
        <PublicFolderBranch
            node={rootNode}
            documentsByFolderId={documentsByFolderId}
            selectedDocumentId={selectedDocumentId}
            onSelectDocument={onSelectDocument}
        />
    );
}