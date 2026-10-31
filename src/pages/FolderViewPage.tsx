import { createPortal } from 'react-dom';
import { useSetAtom } from 'jotai';
import { addToBoardRequestAtom } from '../state/atoms';
import { DocumentContextMenu } from '../components/file-folder-handling/context-menu/DocumentContextMenu';
import { BoardContextMenu } from '../components/file-folder-handling/context-menu/BoardContextMenu';
import { FolderContextMenu } from '../components/file-folder-handling/context-menu/FolderContextMenu';
import { FolderViewHeader } from '../components/folder-view/FolderViewHeader';
import { FolderViewList } from '../components/folder-view/FolderViewList';
import { FolderViewGrid } from '../components/folder-view/FolderViewGrid';
import { useFolderViewState } from '../components/folder-view/useFolderViewState';
import { SharePanel, useSharePanel } from '../components/sharing';
import {
  TrashIcon,
  GlobeAltIcon,
  FolderPlusIcon,
  DocumentPlusIcon,
  FolderIcon,
  ViewColumnsIcon,
} from '@heroicons/react/24/outline';
import {
  Button,
  ConfirmDialog,
  EmptyState,
  PageHeader,
  PageShell,
  SegmentedControl,
  Spinner,
} from '../components/ui';

export function FolderViewPage() {
  const sharePanel = useSharePanel();
  const setAddToBoardRequest = useSetAtom(addToBoardRequestAtom);
  const {
    viewMode,
    setViewMode,
    isTrashMode,
    isSharedMode,
    currentFolderId,
    currentFolder,
    breadcrumbPath,
    displayedFolders,
    displayedBoards,
    displayedDocuments,
    selectedFolderIds,
    selectedDocumentIds,
    isDesktop,
    hasSelection,
    clearSelection,
    deleteConfirmState,
    pendingCreate,
    pendingRename,
    isCreating,
    isRenaming,
    isLoadingCurrentFolder,
    hasItems,
    dropZone,
    contextMenu,
    isClosingContextMenu,
    contextMenuRef,
    handleContextMenu,
    closeContextMenu,
    handleDragStart,
    handleDragEnd,
    handleFolderDragStart,
    handleFolderDragEnd,
    handleBoardDragStart,
    handleBoardDragEnd,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    setPendingCreate,
    handleFolderClick,
    handleFolderDoubleClick,
    handleBoardClick,
    handleNavigateUp,
    handleBreadcrumbClick,
    setFilterMode,
    handleDocumentClick,
    handleDocumentDoubleClick,
    handleSelectAll,
    handleAddFolder,
    handleAddDocument,
    handleOpenCreateBoard,
    handleOpenEditBoard,
    handleInlineCreateSubmit,
    handleInlineCreateCancel,
    setPendingRename,
    handleInlineRenameSubmit,
    handleInlineRenameCancel,
    handleRenameFolder,
    handleDeleteFolder,
    handleConfirmDelete,
    handleCancelDelete,
    handleRenameDocument,
    handleDeleteDocument,
    handleRestoreDocument,
    handlePermanentlyDeleteDocument,
    handleRestoreFolder,
    handlePermanentlyDeleteFolder,
    handleExportFolder,
    handleExportDocument,
    handleTrashBoard,
    handleExportBoard,
    handleRestoreBoard,
    handlePermanentlyDeleteBoard,
    openItemMenu,
  } = useFolderViewState();

  const handleAddToBoard = () => {
    const documentId = contextMenu?.documentId;
    if (!documentId) return;

    setAddToBoardRequest({ documentId });
    closeContextMenu();
  };

  const mode = isTrashMode ? 'trash' : isSharedMode ? 'public' : 'all';
  const canModify = !isTrashMode && !isSharedMode;
  const title = isTrashMode ? 'Trash' : isSharedMode ? 'Shared' : currentFolder?.name || 'Folders';
  const description = isTrashMode
    ? 'Deleted notes, boards, and folders stay here until you restore or remove them.'
    : isSharedMode
      ? 'Notes, boards, and folders with a public link.'
      : currentFolderId
        ? 'Notes, boards, and subfolders in this folder. Drag items to reorganise, double-click a folder to open.'
        : 'Your library, kept in folders. Drag notes and boards between folders to organise them.';

  const emptyTitle = isTrashMode
    ? 'Trash is empty'
    : isSharedMode
      ? 'Nothing is shared yet'
      : currentFolderId
        ? 'This folder is empty'
        : 'A fresh library';
  const emptyDescription = isTrashMode
    ? 'Deleted notes, boards, and folders will appear here.'
    : isSharedMode
      ? 'Share a note, board, or folder from its menu to see it here.'
      : currentFolderId
        ? 'Add a note, a board, or a subfolder to get started.'
        : 'Create your first note, board, or folder, then keep the work moving.';

  return (
    <PageShell scroll="content" contentClassName="desktop-page-content-enter">
      <div
        className="flex min-h-0 flex-1 flex-col"
        onClick={(event) => {
          if (!hasSelection) return;

          const target = event.target as HTMLElement;
          if (target.closest('[data-selection-item="true"]') || target.closest('[data-selection-control="true"]')) {
            return;
          }

          clearSelection();
        }}
      >
        <PageHeader
          title={title}
          description={description}
          meta={
            <>
              <span className="inline-flex items-baseline gap-1.5">
                <span className="text-[13px] font-medium tabular-nums text-ink">{displayedFolders.length}</span>
                {displayedFolders.length === 1 ? 'folder' : 'folders'}
              </span>
              <span className="inline-flex items-baseline gap-1.5">
                <span className="text-[13px] font-medium tabular-nums text-ink">{displayedDocuments.length}</span>
                {displayedDocuments.length === 1 ? 'note' : 'notes'}
              </span>
              <span className="inline-flex items-baseline gap-1.5">
                <span className="text-[13px] font-medium tabular-nums text-ink">{displayedBoards.length}</span>
                {displayedBoards.length === 1 ? 'board' : 'boards'}
              </span>
            </>
          }
          actions={
            <>
              {canModify && (
                <>
                  <Button variant="secondary" icon={<FolderPlusIcon />} onClick={() => void handleAddFolder()}>
                    New folder
                  </Button>
                  <Button variant="secondary" icon={<ViewColumnsIcon />} onClick={() => void handleOpenCreateBoard()}>
                    New board
                  </Button>
                  <Button variant="primary" icon={<DocumentPlusIcon />} onClick={() => void handleAddDocument()}>
                    New note
                  </Button>
                </>
              )}
            </>
          }
        />

        <div className="mb-3 flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
          <SegmentedControl
            label="Library section"
            value={mode}
            onChange={setFilterMode}
            options={[
              { value: 'all', label: 'Files', icon: <FolderIcon className="h-3.5 w-3.5" /> },
              { value: 'trash', label: 'Trash', icon: <TrashIcon className="h-3.5 w-3.5" /> },
              { value: 'public', label: 'Shared', icon: <GlobeAltIcon className="h-3.5 w-3.5" /> },
            ]}
          />
          <span className="hidden text-[11.5px] text-ink-muted sm:inline">
            Drag notes and boards into folders to organise them.
          </span>
        </div>

        <FolderViewHeader
          viewMode={viewMode}
          currentFolderId={currentFolderId}
          isTrashMode={isTrashMode}
          isSharedMode={isSharedMode}
          breadcrumbPath={breadcrumbPath}
          dropZone={dropZone}
          isDesktop={isDesktop}
          hasSelection={hasSelection}
          onViewModeChange={setViewMode}
          onNavigateUp={handleNavigateUp}
          onBreadcrumbClick={handleBreadcrumbClick}
          onSelectAll={handleSelectAll}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        />

        <main
          className="mt-3 flex min-h-0 flex-1 flex-col overflow-hidden border-t border-line"
          onContextMenu={(event) =>
            handleContextMenu(event, 'empty', {
              folderId: currentFolderId || undefined,
              folderName: currentFolder?.name,
            })
          }
        >
          <div className={`min-h-0 flex-1 ${hasItems ? 'overflow-y-auto scrollbar-autohide' : ''}`}>
            {isLoadingCurrentFolder ? (
              <div className="flex h-full items-center justify-center">
                <Spinner label="Loading folder" />
              </div>
            ) : !hasItems ? (
              <div className="flex h-full items-center justify-center p-6">
                <EmptyState
                  compact
                  icon={<FolderIcon />}
                  title={emptyTitle}
                  description={emptyDescription}
                  action={
                    canModify ? (
                      <>
                        <Button variant="primary" icon={<DocumentPlusIcon />} onClick={() => void handleAddDocument()}>
                          New note
                        </Button>
                        <Button variant="secondary" icon={<ViewColumnsIcon />} onClick={() => void handleOpenCreateBoard()}>
                          New board
                        </Button>
                      </>
                    ) : undefined
                  }
                  className="w-full max-w-md"
                />
              </div>
            ) : viewMode === 'list' ? (
              <FolderViewList
                displayedFolders={displayedFolders}
                displayedBoards={displayedBoards}
                displayedDocuments={displayedDocuments}
                currentFolderId={currentFolderId}
                selectedFolderIds={selectedFolderIds}
                selectedDocumentIds={selectedDocumentIds}
                pendingCreate={pendingCreate}
                pendingRename={pendingRename}
                isCreating={isCreating}
                isRenaming={isRenaming}
                dropZone={dropZone}
                onPendingNameChange={(value) =>
                  setPendingCreate((previous) => (previous ? { ...previous, name: value } : previous))
                }
                onCreateSubmit={handleInlineCreateSubmit}
                onCreateCancel={handleInlineCreateCancel}
                onPendingRenameChange={(value) =>
                  setPendingRename((previous) => (previous ? { ...previous, name: value } : previous))
                }
                onRenameSubmit={handleInlineRenameSubmit}
                onRenameCancel={handleInlineRenameCancel}
                onFolderClick={handleFolderClick}
                onFolderDoubleClick={handleFolderDoubleClick}
                onBoardClick={handleBoardClick}
                onDocumentClick={handleDocumentClick}
                onDocumentDoubleClick={handleDocumentDoubleClick}
                onItemContextMenu={(event, type, options) =>
                  handleContextMenu(
                    event,
                    isTrashMode && type === 'folder'
                      ? 'trash-folder'
                      : isTrashMode && type === 'document'
                        ? 'trash-document'
                        : isTrashMode && type === 'board'
                          ? 'trash-board'
                          : type,
                    options
                  )
                }
                onOpenItemMenu={(event, type, options) =>
                  openItemMenu(
                    event,
                    isTrashMode && type === 'folder'
                      ? 'trash-folder'
                      : isTrashMode && type === 'document'
                        ? 'trash-document'
                        : isTrashMode && type === 'board'
                          ? 'trash-board'
                          : type,
                    options
                  )
                }
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
                onFolderDragStart={handleFolderDragStart}
                onFolderDragEnd={handleFolderDragEnd}
                onBoardDragStart={handleBoardDragStart}
                onBoardDragEnd={handleBoardDragEnd}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
              />
            ) : (
              <FolderViewGrid
                displayedFolders={displayedFolders}
                displayedBoards={displayedBoards}
                displayedDocuments={displayedDocuments}
                currentFolderId={currentFolderId}
                selectedFolderIds={selectedFolderIds}
                selectedDocumentIds={selectedDocumentIds}
                pendingCreate={pendingCreate}
                pendingRename={pendingRename}
                isCreating={isCreating}
                isRenaming={isRenaming}
                dropZone={dropZone}
                onPendingNameChange={(value) =>
                  setPendingCreate((previous) => (previous ? { ...previous, name: value } : previous))
                }
                onCreateSubmit={handleInlineCreateSubmit}
                onCreateCancel={handleInlineCreateCancel}
                onPendingRenameChange={(value) =>
                  setPendingRename((previous) => (previous ? { ...previous, name: value } : previous))
                }
                onRenameSubmit={handleInlineRenameSubmit}
                onRenameCancel={handleInlineRenameCancel}
                onFolderClick={handleFolderClick}
                onFolderDoubleClick={handleFolderDoubleClick}
                onBoardClick={handleBoardClick}
                onDocumentClick={handleDocumentClick}
                onDocumentDoubleClick={handleDocumentDoubleClick}
                onItemContextMenu={(event, type, options) =>
                  handleContextMenu(
                    event,
                    isTrashMode && type === 'folder'
                      ? 'trash-folder'
                      : isTrashMode && type === 'document'
                        ? 'trash-document'
                        : isTrashMode && type === 'board'
                          ? 'trash-board'
                          : type,
                    options
                  )
                }
                onOpenItemMenu={(event, type, options) =>
                  openItemMenu(
                    event,
                    isTrashMode && type === 'folder'
                      ? 'trash-folder'
                      : isTrashMode && type === 'document'
                        ? 'trash-document'
                        : isTrashMode && type === 'board'
                          ? 'trash-board'
                          : type,
                    options
                  )
                }
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
                onFolderDragStart={handleFolderDragStart}
                onFolderDragEnd={handleFolderDragEnd}
                onBoardDragStart={handleBoardDragStart}
                onBoardDragEnd={handleBoardDragEnd}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
              />
            )}
          </div>
        </main>
      </div>

      {contextMenu && (contextMenu.type === 'document' || contextMenu.type === 'trash-document') &&
        createPortal(
          <DocumentContextMenu
            contextMenu={{
              x: contextMenu.x,
              y: contextMenu.y,
              type: contextMenu.type,
              documentId: contextMenu.documentId,
            }}
            contextMenuRef={contextMenuRef}
            onAddFolder={handleAddFolder}
            onAddDocument={handleAddDocument}
            onRenameDocument={handleRenameDocument}
            onMakePublicDocument={() => {
              if (contextMenu?.documentId) {
                sharePanel.openSharePanel({
                  targetType: 'document',
                  targetId: contextMenu.documentId,
                  targetTitle: 'Note',
                });
                closeContextMenu();
              }
            }}
            onAddToBoard={handleAddToBoard}
            onDeleteDocument={handleDeleteDocument}
            onRestoreDocument={handleRestoreDocument}
            onPermanentlyDeleteDocument={handlePermanentlyDeleteDocument}
            onExportDocument={handleExportDocument}
            onClose={closeContextMenu}
            isClosing={isClosingContextMenu}
          />,
          document.body
        )}

      {contextMenu && (contextMenu.type === 'empty' || contextMenu.type === 'folder' || contextMenu.type === 'trash-folder') &&
        createPortal(
          <FolderContextMenu
            contextMenu={{
              x: contextMenu.x,
              y: contextMenu.y,
              type: contextMenu.type,
              folderId: contextMenu.folderId,
              folderName: contextMenu.folderName,
            }}
            contextMenuRef={contextMenuRef}
            onAddFolder={handleAddFolder}
            onAddDocument={handleAddDocument}
            onAddBoard={handleOpenCreateBoard}
            onRenameFolder={handleRenameFolder}
            onMakePublicFolder={() => {
              if (contextMenu?.folderId) {
                sharePanel.openSharePanel({
                  targetType: 'folder',
                  targetId: contextMenu.folderId,
                  targetTitle: contextMenu.folderName || 'Folder',
                });
                closeContextMenu();
              }
            }}
            onDeleteFolder={handleDeleteFolder}
            onRestoreFolder={handleRestoreFolder}
            onPermanentlyDeleteFolder={handlePermanentlyDeleteFolder}
            onExportFolder={handleExportFolder}
            onClose={closeContextMenu}
            isClosing={isClosingContextMenu}
          />,
          document.body
        )}

      {contextMenu && (contextMenu.type === 'board' || contextMenu.type === 'trash-board') &&
        createPortal(
          <BoardContextMenu
            contextMenu={{
              x: contextMenu.x,
              y: contextMenu.y,
              type: contextMenu.type,
              boardId: contextMenu.boardId,
              boardName: contextMenu.boardName,
            }}
            contextMenuRef={contextMenuRef}
            onOpenBoard={() => {
              const board = contextMenu.boardId
                ? displayedBoards.find((item) => item.id === contextMenu.boardId)
                : undefined;
              closeContextMenu();
              if (board) {
                handleBoardClick(board);
              }
            }}
            onEditBoard={() => handleOpenEditBoard(contextMenu.boardId)}
            onShareBoard={() => {
              if (contextMenu.boardId) {
                sharePanel.openSharePanel({
                  targetType: 'board',
                  targetId: contextMenu.boardId,
                  targetTitle: contextMenu.boardName || 'Board',
                });
                closeContextMenu();
              }
            }}
            onExportBoard={() => {
              if (contextMenu.boardId) {
                void handleExportBoard();
              } else {
                closeContextMenu();
              }
            }}
            onTrashBoard={() => void handleTrashBoard()}
            onRestoreBoard={() => void handleRestoreBoard()}
            onPermanentlyDeleteBoard={() => void handlePermanentlyDeleteBoard()}
            onClose={closeContextMenu}
            isClosing={isClosingContextMenu}
          />,
          document.body
        )}

      <ConfirmDialog
        open={Boolean(deleteConfirmState)}
        title={deleteConfirmState?.title || 'Delete items'}
        description={deleteConfirmState?.message || 'Move the selected items to trash?'}
        confirmLabel={deleteConfirmState?.isPermanent ? 'Delete forever' : 'Move to trash'}
        tone="danger"
        onConfirm={() => void handleConfirmDelete()}
        onCancel={handleCancelDelete}
      />

      {sharePanel.target && (
        <SharePanel
          open
          onClose={sharePanel.closeSharePanel}
          targetType={sharePanel.target.targetType}
          targetId={sharePanel.target.targetId}
          targetTitle={sharePanel.target.targetTitle}
          folderId={sharePanel.target.folderId}
          folderName={sharePanel.target.folderName}
          onChanged={sharePanel.target.onChanged}
        />
      )}
    </PageShell>
  );
}
