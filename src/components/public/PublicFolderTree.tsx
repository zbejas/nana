import {
    ChevronDownIcon,
    ChevronRightIcon,
    DocumentTextIcon,
    FolderIcon,
    ViewColumnsIcon,
} from '@heroicons/react/24/outline';
import { useState } from 'react';
import type { Document } from '../../lib/documents';
import type { FolderTreeNode } from '../../lib/folders';
import type { PublicFolderBoard } from '../../lib/public-sharing';

interface PublicFolderTreeProps {
    nodes: FolderTreeNode[];
    documentsByFolderId: Map<string, Document[]>;
    boardsByFolderId: Map<string, PublicFolderBoard[]>;
    selectedDocumentId: string | null;
    selectedBoardId: string | null;
    onSelectDocument: (documentId: string) => void;
    onSelectBoard: (boardId: string) => void;
    rootFolderId: string;
}

function PublicFolderBranch({
    node,
    documentsByFolderId,
    boardsByFolderId,
    selectedDocumentId,
    selectedBoardId,
    onSelectDocument,
    onSelectBoard,
}: {
    node: FolderTreeNode;
    documentsByFolderId: Map<string, Document[]>;
    boardsByFolderId: Map<string, PublicFolderBoard[]>;
    selectedDocumentId: string | null;
    selectedBoardId: string | null;
    onSelectDocument: (documentId: string) => void;
    onSelectBoard: (boardId: string) => void;
}) {
    const [expanded, setExpanded] = useState(true);
    const documents = documentsByFolderId.get(node.id) || [];
    const boards = boardsByFolderId.get(node.id) || [];
    const hasChildren = node.subfolders.length > 0 || documents.length > 0 || boards.length > 0;

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
                    {boards.map((board) => {
                        const isSelected = selectedBoardId === board.id;

                        return (
                            <button
                                key={board.id}
                                type="button"
                                onClick={() => onSelectBoard(board.id)}
                                className={`flex w-full items-center gap-2 rounded-control px-2 py-2 text-left text-sm transition-colors ${
                                    isSelected
                                        ? 'bg-signal-soft text-ink ring-1 ring-signal/35'
                                        : 'text-ink-muted hover:bg-surface-raised hover:text-ink'
                                }`}
                            >
                                <ViewColumnsIcon className="h-4 w-4 shrink-0" />
                                <span className="truncate">{board.name || 'Untitled board'}</span>
                            </button>
                        );
                    })}

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
                            boardsByFolderId={boardsByFolderId}
                            selectedDocumentId={selectedDocumentId}
                            selectedBoardId={selectedBoardId}
                            onSelectDocument={onSelectDocument}
                            onSelectBoard={onSelectBoard}
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
    boardsByFolderId,
    selectedDocumentId,
    selectedBoardId,
    onSelectDocument,
    onSelectBoard,
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
            boardsByFolderId={boardsByFolderId}
            selectedDocumentId={selectedDocumentId}
            selectedBoardId={selectedBoardId}
            onSelectDocument={onSelectDocument}
            onSelectBoard={onSelectBoard}
        />
    );
}
