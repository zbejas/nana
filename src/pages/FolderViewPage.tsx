import { createPortal } from 'react-dom';
import { DocumentContextMenu } from '../components/file-folder-handling/context-menu/DocumentContextMenu';
import { FolderContextMenu } from '../components/file-folder-handling/context-menu/FolderContextMenu';
import { FolderViewHeader } from '../components/folder-view/FolderViewHeader';
import { FolderViewList } from '../components/folder-view/FolderViewList';
import { FolderViewGrid } from '../components/folder-view/FolderViewGrid';
import { useFolderViewState } from '../components/folder-view/useFolderViewState';
import { ConfirmDialog } from '../components/modals/ConfirmDialog';
import { PublicShareModal } from '../components/modals/PublicShareModal';
import { usePublicShareModalState } from '../components/modals/usePublicShareModalState';
import { TrashIcon, GlobeAltIcon, EllipsisHorizontalIcon, FolderPlusIcon, DocumentPlusIcon } from '@heroicons/react/24/outline';
import { useEffect, useRef, useState as useLocalState } from 'react';

export function FolderViewPage() {
  const publicShareModal = usePublicShareModalState();
  const {
    viewMode,
    setViewMode,
    isTrashMode,
    isSharedMode,
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
    setFilterMode,
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
          <FolderViewActions
            isTrashMode={isTrashMode}
            isSharedMode={isSharedMode}
            onSelectMode={setFilterMode}
            onAddFolder={() => { void handleAddFolder(); }}
            onAddDocument={() => { void handleAddDocument(); }}
          />

          <div className={`min-h-0 flex-1 ${hasItems ? 'overflow-y-auto scrollbar-autohide' : ''}`}>
            {isLoadingCurrentFolder ? (
              <div className="h-full flex items-center justify-center text-sm text-gray-400">Loading folder...</div>
            ) : !hasItems ? (
              <div className="h-full flex items-center justify-center text-sm text-gray-500">{isSharedMode ? 'No public folders or documents.' : 'No folders or documents here.'}</div>
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
            onMakePublicDocument={() => {
              if (contextMenu?.documentId) {
                void publicShareModal.openDocument(contextMenu.documentId);
                closeContextMenu();
              }
            }}
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
            onMakePublicFolder={() => {
              if (contextMenu?.folderId) {
                void publicShareModal.openFolder(contextMenu.folderId);
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

      <PublicShareModal
        target={publicShareModal.target}
        isOpen={publicShareModal.isOpen}
        isSaving={publicShareModal.isSaving}
        onClose={publicShareModal.close}
        onSave={publicShareModal.save}
      />
    </div>
  );
}

/* ── Dropdown actions bar ── */

interface FolderViewActionsProps {
  isTrashMode: boolean;
  isSharedMode: boolean;
  onSelectMode: (mode: 'all' | 'trash' | 'public') => void;
  onAddFolder: () => void;
  onAddDocument: () => void;
}

function FolderViewActions({ isTrashMode, isSharedMode, onSelectMode, onAddFolder, onAddDocument }: FolderViewActionsProps) {
  const [open, setOpen] = useLocalState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const disabled = isTrashMode || isSharedMode;

  return (
    <div className="mb-4 flex items-center gap-2">
      {/* Left: active view badge */}
      <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${
        isTrashMode
          ? 'bg-amber-400/15 text-amber-200/90'
          : isSharedMode
            ? 'bg-emerald-400/15 text-emerald-200/90'
            : 'bg-white/8 text-gray-400'
      }`}>
        {isTrashMode ? <TrashIcon className="w-3 h-3" /> : isSharedMode ? <GlobeAltIcon className="w-3 h-3" /> : <FolderPlusIcon className="w-3 h-3" />}
        {isTrashMode ? 'Trash' : isSharedMode ? 'Public' : 'All files'}
      </span>

      {/* Right: single actions dropdown */}
      <div className="relative ml-auto" ref={ref}>
        <button
          onClick={() => setOpen((v) => !v)}
          className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold transition-colors ${
            open
              ? 'border-white/20 bg-white/10 text-white'
              : 'border-white/10 bg-white/5 text-gray-200 hover:bg-white/10'
          }`}
          aria-haspopup="true"
          aria-expanded={open}
        >
          <EllipsisHorizontalIcon className="w-4 h-4" />
          Actions
        </button>

        {open && (
          <div className="absolute right-0 top-full z-30 mt-1.5 w-44 overflow-hidden rounded-lg border border-white/15 bg-stone-900/95 backdrop-blur-xl shadow-xl py-1">
            <button
              onClick={() => { onAddFolder(); setOpen(false); }}
              disabled={disabled}
              className={`flex w-full items-center gap-2.5 px-3.5 py-2.5 text-xs font-medium transition-colors ${
                disabled ? 'text-gray-500 cursor-not-allowed' : 'text-gray-200 hover:bg-white/10'
              }`}
            >
              <FolderPlusIcon className="w-4 h-4 text-gray-400" />
              New folder
            </button>
            <button
              onClick={() => { onAddDocument(); setOpen(false); }}
              disabled={disabled}
              className={`flex w-full items-center gap-2.5 px-3.5 py-2.5 text-xs font-medium transition-colors ${
                disabled ? 'text-gray-500 cursor-not-allowed' : 'text-blue-200 hover:bg-white/10'
              }`}
            >
              <DocumentPlusIcon className="w-4 h-4 text-blue-400" />
              New document
            </button>

            <div className="my-1 border-t border-white/10" />

            <button
              onClick={() => { onSelectMode('all'); setOpen(false); }}
              className={`flex w-full items-center gap-2.5 px-3.5 py-2.5 text-xs font-medium transition-colors ${
                !isTrashMode && !isSharedMode ? 'text-white bg-white/10' : 'text-gray-300 hover:bg-white/10'
              }`}
            >
              <FolderPlusIcon className="w-4 h-4 text-gray-400" />
              All files
            </button>
            <button
              onClick={() => { onSelectMode('trash'); setOpen(false); }}
              className={`flex w-full items-center gap-2.5 px-3.5 py-2.5 text-xs font-medium transition-colors ${
                isTrashMode ? 'text-amber-200 bg-amber-400/10' : 'text-amber-200/70 hover:bg-white/10'
              }`}
            >
              <TrashIcon className="w-4 h-4" />
              Trash
            </button>
            <button
              onClick={() => { onSelectMode('public'); setOpen(false); }}
              className={`flex w-full items-center gap-2.5 px-3.5 py-2.5 text-xs font-medium transition-colors ${
                isSharedMode ? 'text-emerald-200 bg-emerald-400/10' : 'text-emerald-200/70 hover:bg-white/10'
              }`}
            >
              <GlobeAltIcon className="w-4 h-4" />
              Public
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
