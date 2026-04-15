import { createPortal } from 'react-dom';
import { DocumentContextMenu } from '../components/file-folder-handling/context-menu/DocumentContextMenu';
import { FolderContextMenu } from '../components/file-folder-handling/context-menu/FolderContextMenu';
import { FolderViewHeader } from '../components/folder-view/FolderViewHeader';
import { FolderViewList } from '../components/folder-view/FolderViewList';
import { FolderViewGrid } from '../components/folder-view/FolderViewGrid';
import { useFolderViewState } from '../components/folder-view/useFolderViewState';
import { ConfirmDialog } from '../components/modals/ConfirmDialog';
import { TrashIcon } from '@heroicons/react/24/outline';

export function FolderViewPage() {
  const {
    viewMode,
    setViewMode,
    isTrashMode,
    currentFolderId,
    currentFolder,
    breadcrumbPath,
    displayedFolders,
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
    handleDragOver,
    handleDragLeave,
    handleDrop,
    setPendingCreate,
    handleFolderClick,
    handleFolderDoubleClick,
    handleNavigateUp,
    handleBreadcrumbClick,
    openTrash,
    exitTrash,
    handleDocumentClick,
    handleDocumentDoubleClick,
    handleSelectAll,
    handleAddFolder,
    handleAddDocument,
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
    handleExportDocument,
    handleExportFolder,
    openItemMenu,
  } = useFolderViewState();

  return (
    <div
      className="h-full bg-black/40 backdrop-blur-md overflow-hidden p-4 sm:p-6"
      onClick={(event) => {
        if (!hasSelection) {
          return;
        }

        const target = event.target as HTMLElement;
        if (target.closest('[data-selection-item="true"]') || target.closest('[data-selection-control="true"]')) {
          return;
        }

        clearSelection();
      }}
    >
      <div className="desktop-page-content-enter h-full max-w-5xl mx-auto flex flex-col gap-4">
        <FolderViewHeader
          viewMode={viewMode}
          currentFolderId={currentFolderId}
          isTrashMode={isTrashMode}
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
          className={`w-full min-h-0 flex-1 border rounded-lg p-4 flex flex-col overflow-hidden transition-colors ${
            'bg-white/5 border-white/10'
          }`}
          onContextMenu={(event) =>
            handleContextMenu(event, 'empty', {
              folderId: currentFolderId || undefined,
              folderName: currentFolder?.name,
            })
          }
        >
          <div className="mb-4 flex items-center gap-2">
            <button
              onClick={isTrashMode ? exitTrash : openTrash}
              className={`inline-flex h-8 items-center justify-center gap-1 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors ${
                isTrashMode
                  ? 'border-blue-500/30 bg-blue-500/20 text-blue-100 hover:bg-blue-500/30'
                  : 'border-white/10 bg-white/5 text-gray-200 hover:bg-white/10'
              }`}
              aria-pressed={isTrashMode}
            >
              <TrashIcon className="w-3.5 h-3.5" /> Trash
            </button>

            <div className="ml-auto flex items-center gap-2">
              <button
                onClick={() => {
                  void handleAddFolder();
                }}
                disabled={isTrashMode}
                className="inline-flex h-8 items-center justify-center rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-gray-200 hover:bg-white/10 transition-colors"
              >
                New folder
              </button>
              <button
                onClick={() => {
                  void handleAddDocument();
                }}
                disabled={isTrashMode}
                className="inline-flex h-8 items-center justify-center rounded-lg border border-blue-500/30 bg-blue-500/20 px-3 py-2 text-xs font-semibold text-blue-100 hover:bg-blue-500/30 transition-colors"
              >
                New document
              </button>
            </div>
          </div>

          <div className={`min-h-0 flex-1 ${hasItems ? 'overflow-y-auto scrollbar-autohide' : ''}`}>
            {isLoadingCurrentFolder ? (
              <div className="h-full flex items-center justify-center text-sm text-gray-400">Loading folder...</div>
            ) : !hasItems ? (
              <div className="h-full flex items-center justify-center text-sm text-gray-500">No folders or documents here.</div>
            ) : viewMode === 'list' ? (
              <FolderViewList
                displayedFolders={displayedFolders}
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
                  setPendingCreate((previous) =>
                    previous ? { ...previous, name: value } : previous
                  )
                }
                onCreateSubmit={handleInlineCreateSubmit}
                onCreateCancel={handleInlineCreateCancel}
                onPendingRenameChange={(value) =>
                  setPendingRename((previous) =>
                    previous ? { ...previous, name: value } : previous
                  )
                }
                onRenameSubmit={handleInlineRenameSubmit}
                onRenameCancel={handleInlineRenameCancel}
                onFolderClick={handleFolderClick}
                onFolderDoubleClick={handleFolderDoubleClick}
                onDocumentClick={handleDocumentClick}
                onDocumentDoubleClick={handleDocumentDoubleClick}
                onItemContextMenu={(event, type, options) =>
                  handleContextMenu(
                    event,
                    isTrashMode && type === 'folder'
                      ? 'trash-folder'
                      : isTrashMode && type === 'document'
                        ? 'trash-document'
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
                        : type,
                    options
                  )
                }
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
                onFolderDragStart={handleFolderDragStart}
                onFolderDragEnd={handleFolderDragEnd}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
              />
            ) : (
              <FolderViewGrid
                displayedFolders={displayedFolders}
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
                  setPendingCreate((previous) =>
                    previous ? { ...previous, name: value } : previous
                  )
                }
                onCreateSubmit={handleInlineCreateSubmit}
                onCreateCancel={handleInlineCreateCancel}
                onPendingRenameChange={(value) =>
                  setPendingRename((previous) =>
                    previous ? { ...previous, name: value } : previous
                  )
                }
                onRenameSubmit={handleInlineRenameSubmit}
                onRenameCancel={handleInlineRenameCancel}
                onFolderClick={handleFolderClick}
                onFolderDoubleClick={handleFolderDoubleClick}
                onDocumentClick={handleDocumentClick}
                onDocumentDoubleClick={handleDocumentDoubleClick}
                onItemContextMenu={(event, type, options) =>
                  handleContextMenu(
                    event,
                    isTrashMode && type === 'folder'
                      ? 'trash-folder'
                      : isTrashMode && type === 'document'
                        ? 'trash-document'
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
                        : type,
                    options
                  )
                }
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
                onFolderDragStart={handleFolderDragStart}
                onFolderDragEnd={handleFolderDragEnd}
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
            onRenameFolder={handleRenameFolder}
            onDeleteFolder={handleDeleteFolder}
            onRestoreFolder={handleRestoreFolder}
            onPermanentlyDeleteFolder={handlePermanentlyDeleteFolder}
            onExportFolder={handleExportFolder}
            onClose={closeContextMenu}
            isClosing={isClosingContextMenu}
          />,
          document.body
        )}

      <ConfirmDialog
        isOpen={!!deleteConfirmState}
        title={deleteConfirmState?.title || 'Delete items'}
        message={deleteConfirmState?.message || 'Move selected items to trash?'}
        onSave={() => undefined}
        onDiscard={() => {
          void handleConfirmDelete();
        }}
        onCancel={handleCancelDelete}
        saveLabel=""
        discardLabel={deleteConfirmState?.isPermanent ? 'Delete Forever' : 'Delete'}
        cancelLabel="Cancel"
      />
    </div>
  );
}
