import { useMemo } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useLocation } from "react-router-dom";
import { useAtomValue, useSetAtom } from "jotai";
import {
  ClockIcon,
  FolderIcon,
  ChatBubbleLeftRightIcon,
  ViewColumnsIcon,
  XMarkIcon,
  ChevronDoubleLeftIcon,
  PlusIcon,
  FolderPlusIcon,
} from '@heroicons/react/24/outline';
import { useAuth } from "../lib/auth";
import { useSidebar } from "../state/hooks";
import {
  foldersAtom,
  rootDocumentsAtom,
  folderDocumentsAtom,
  recentDocumentsAtom,
  expandedFoldersAtom,
  isDataLoadingAtom,
  loadedFoldersAtom,
  loadingFoldersAtom,
  toggleFolderAtom,
  loadFolderDocumentsAtom,
  selectedDocumentAtom,
  saveCallbackAtom,
  resetEditorAtom,
  startNewDocumentAtom,
  selectDocumentAtom,
} from "../state/atoms";
import { FolderContextMenu } from "./file-folder-handling/context-menu/FolderContextMenu";
import { DocumentContextMenu } from "./file-folder-handling/context-menu/DocumentContextMenu";
import { RecentDocumentsSection } from "./sidebar/RecentDocumentsSection";
import { ProfileBar } from "./sidebar/ProfileBar";
import { SidebarDialogs } from "./sidebar/SidebarDialogs";
import { SearchBar } from "./sidebar/SearchBar";
import { RootDocumentsSection } from "./sidebar/RootDocumentsSection";
import { FoldersSection } from "./sidebar/FoldersSection";
import { SidebarResizeHandle } from "./sidebar/SidebarResizeHandle";
import { useSidebarHandlers } from "./sidebar/useSidebarHandlers";
import { useInlineInputState } from "./sidebar/useInlineInputState";
import { useDialogState } from "./sidebar/useDialogState";
import { useMobileState } from "./sidebar/useMobileState";
import { CompactSidebar } from "./sidebar/CompactSidebar";
import { useContextMenuState, useContextMenuHandlers } from "./file-folder-handling";
import { PublicShareModal } from "./modals/PublicShareModal";
import { usePublicShareModalState } from "./modals/usePublicShareModalState";
import { useSidebarWidth } from "../lib/settings";
import { IconButton } from "./ui";
import logo from '../assets/nana.svg';

const noopLoadFolderDocuments = async (_folderId: string, _isTrash?: boolean) => {};

const NAV_ITEMS = [
  { key: 'timeline', label: 'Timeline', path: '/timeline', icon: ClockIcon },
  { key: 'board', label: 'Boards', path: '/board', icon: ViewColumnsIcon },
  { key: 'folders', label: 'Folders', path: '/folders', icon: FolderIcon },
  { key: 'chat', label: 'Chat', path: '/chat', icon: ChatBubbleLeftRightIcon },
] as const;

function isNavActive(pathname: string, path: string): boolean {
  return pathname === path || pathname.startsWith(`${path}/`);
}

export function Sidebar() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const sidebarHook = useSidebar();
  const { isResizing, setIsResizing } = sidebarHook;

  const folders = useAtomValue(foldersAtom);
  const rootDocuments = useAtomValue(rootDocumentsAtom);
  const folderDocuments = useAtomValue(folderDocumentsAtom);
  const allRecentDocuments = useAtomValue(recentDocumentsAtom);
  const expandedFolders = useAtomValue(expandedFoldersAtom);
  const isDataLoading = useAtomValue(isDataLoadingAtom);
  const selectedDocument = useAtomValue(selectedDocumentAtom);
  const saveCallback = useAtomValue(saveCallbackAtom);
  const toggleFolder = useSetAtom(toggleFolderAtom);
  const select = useSetAtom(selectDocumentAtom);
  const startNew = useSetAtom(startNewDocumentAtom);
  const reset = useSetAtom(resetEditorAtom);

  const loadedFolders = useAtomValue(loadedFoldersAtom);
  const loadingFolders = useAtomValue(loadingFoldersAtom);
  const loadFolderDocuments = useAtomValue(loadFolderDocumentsAtom) ?? noopLoadFolderDocuments;

  const sidebarWidth = useSidebarWidth();
  const { isOpen, toggle } = sidebarHook;

  const { isMobile, swipeStartX, setSwipeStartX, swipeCurrentX, setSwipeCurrentX, prepareForNavigation } = useMobileState(isOpen, toggle);

  const handlers = useSidebarHandlers({
    editorActions: { select, startNew, saveCallback, reset },
    sidebarActions: { toggle, prepareForNavigation },
    dataHook: { expandedFolders, toggleFolder },
  });

  const recentDocuments = useMemo(() => allRecentDocuments.slice(0, 3), [allRecentDocuments]);

  const { contextMenu, isClosingContextMenu, contextMenuRef, handleContextMenu, closeContextMenu } = useContextMenuState();
  const { inlineInput, setInlineInput, renamingFolderId, setRenamingFolderId } = useInlineInputState();
  const {
    showUnsavedDialog, setShowUnsavedDialog, pendingDocument, setPendingDocument,
    showDeleteDialog, deleteDialogConfig, openDeleteDialog, closeDeleteDialog,
    showLogoutDialog, setShowLogoutDialog
  } = useDialogState();
  const publicShareModal = usePublicShareModalState();

  const contextMenuHandlers = useContextMenuHandlers({
    contextMenu,
    closeContextMenu,
    selectedDocumentId: selectedDocument?.id,
    handlers,
    setInlineInput,
    setRenamingFolderId,
    openDeleteDialog,
    toggle,
  });

  const handleLogoutClick = () => setShowLogoutDialog(true);

  const handleLogoutConfirm = () => {
    signOut();
    setShowLogoutDialog(false);
    navigate('/');
  };

  const handleViewNavigation = (path: string) => {
    if (isMobile) {
      prepareForNavigation();
      toggle();
    }
    navigate(path);
  };

  if (!user) return null;

  return (
    <>
      <CompactSidebar
        isExpanded={isOpen}
        onToggleExpanded={toggle}
        onRequestSignOut={handleLogoutClick}
        onNavigateSettings={() => handleViewNavigation('/settings')}
        user={user}
      />

      <aside
        className="fixed left-0 top-0 z-50 flex h-full flex-col overflow-hidden border-r border-line bg-canvas-deep"
        style={{
          width: isMobile ? '100%' : `${sidebarWidth}px`,
          transform: isOpen ? 'translateX(0)' : (isMobile ? 'translateX(-100%)' : `translateX(-${sidebarWidth}px)`),
          transition: swipeCurrentX !== null || isResizing ? 'none' : 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        }}
        aria-label="Workspace"
        aria-hidden={!isOpen}
        inert={!isOpen}
        onContextMenu={(event) => handleContextMenu(event, 'empty')}
        onTouchStart={(event) => {
          if (!isMobile || !isOpen) return;
          const touch = event.touches[0];
          if (touch) {
            setSwipeStartX(touch.clientX);
            setSwipeCurrentX(touch.clientX);
          }
        }}
        onTouchMove={(event) => {
          if (!isMobile || !isOpen || swipeStartX === null) return;
          const touch = event.touches[0];
          if (touch) {
            setSwipeCurrentX(touch.clientX);
            if (touch.clientX - swipeStartX < -50) event.preventDefault();
          }
        }}
        onTouchEnd={() => {
          if (!isMobile || !isOpen || swipeStartX === null || swipeCurrentX === null) {
            setSwipeStartX(null);
            setSwipeCurrentX(null);
            return;
          }
          if (swipeCurrentX - swipeStartX < -100) toggle();
          setSwipeStartX(null);
          setSwipeCurrentX(null);
        }}
      >
        <div className="flex min-h-0 flex-1 flex-col" style={{ width: isMobile ? '100%' : `${sidebarWidth}px` }}>
          <div className="flex items-center gap-2.5 px-4 pb-3 pt-4">
            <button
              onClick={() => {
                reset();
                handleViewNavigation('/timeline');
              }}
              className="flex min-h-11 min-w-0 items-center gap-2.5 md:min-h-0"
              aria-label="Nana home"
            >
              <img src={logo} alt="" className="h-6 w-6 shrink-0" draggable={false} />
              <span className="font-display text-[15px] font-semibold leading-none tracking-[-0.02em] text-ink">Nana</span>
            </button>
            <div className="ml-auto flex items-center gap-0.5">
              <IconButton
                label={isMobile ? 'Close menu' : 'Collapse sidebar'}
                size={isMobile ? 'md' : 'sm'}
                onClick={toggle}
              >
                {isMobile ? <XMarkIcon /> : <ChevronDoubleLeftIcon />}
              </IconButton>
            </div>
          </div>

          <nav className="px-2 pb-2" aria-label="Primary">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const active = isNavActive(location.pathname, item.path);
              return (
                <button
                  key={item.key}
                  onClick={() => handleViewNavigation(item.path)}
                  aria-current={active ? 'page' : undefined}
                  className={`group relative flex h-8 w-full items-center gap-2.5 rounded-[6px] px-2.5 text-[13px] font-medium transition-colors ${
                    active
                      ? 'bg-signal-soft text-signal'
                      : 'text-ink-secondary hover:bg-surface hover:text-ink'
                  }`}
                >
                  {active && (
                    <span className="absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 bg-signal" aria-hidden="true" />
                  )}
                  <Icon className="h-4 w-4 shrink-0" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>

          <SearchBar
            onDocumentClick={handlers.handleDocumentClick}
            onContextMenu={(event, documentId) => handleContextMenu(event, 'document', { documentId })}
          />

          <div className="flex-1 overflow-y-auto scrollbar-autohide pb-3" style={{ scrollbarGutter: 'stable' }}>
            {isDataLoading ? (
              <div className="flex items-center justify-center py-8">
                <span className="h-5 w-5 animate-spin rounded-full border-2 border-ink-muted/30 border-t-signal" />
              </div>
            ) : (
              <>
                <RecentDocumentsSection
                  documents={recentDocuments}
                  onDocumentClick={handlers.handleDocumentClick}
                  onContextMenu={(event, documentId) => handleContextMenu(event, 'document', { documentId })}
                  isLoading={isDataLoading}
                />

                <section className="px-3 pt-5" aria-label="Files">
                  <div className="flex items-center gap-1 px-2 pb-1.5">
                    <p className="eyebrow flex-1">Files</p>
                    <IconButton
                      label="New folder"
                      size="sm"
                      className="h-6 w-6 [&>svg]:h-3.5 [&>svg]:w-3.5"
                      onClick={() => void handlers.handleAddFolder()}
                    >
                      <FolderPlusIcon />
                    </IconButton>
                    <IconButton
                      label="New note"
                      size="sm"
                      className="h-6 w-6 [&>svg]:h-3.5 [&>svg]:w-3.5"
                      onClick={() => void handlers.handleAddDocument()}
                    >
                      <PlusIcon />
                    </IconButton>
                  </div>

                  <div className="space-y-px">
                    <RootDocumentsSection
                      documents={rootDocuments}
                      isDataLoading={isDataLoading}
                      dropZone={handlers.dropZone}
                      activeDocumentId={selectedDocument?.id}
                      onDocumentClick={handlers.handleDocumentClick}
                      onContextMenu={(event, documentId) => handleContextMenu(event, 'document', { documentId })}
                      onDragStart={handlers.handleDragStart}
                      onDragEnd={handlers.handleDragEnd}
                      onDragOver={handlers.handleDragOver}
                      onDragLeave={(event) => handlers.handleDragLeave(event)}
                      onDrop={handlers.handleDrop}
                      onAddDocument={handlers.handleAddDocument}
                    />

                    <FoldersSection
                      folders={folders}
                      isDataLoading={isDataLoading}
                      activeDocumentId={selectedDocument?.id}
                      expandedFolders={expandedFolders}
                      folderDocuments={folderDocuments}
                      loadedFolders={loadedFolders}
                      loadingFolders={loadingFolders}
                      dropZone={handlers.dropZone}
                      dropPosition={handlers.dropPosition}
                      inlineInput={inlineInput}
                      renamingFolderId={renamingFolderId}
                      onToggleFolder={toggleFolder}
                      onLoadFolder={(folderId) => loadFolderDocuments(folderId, false)}
                      onContextMenu={handleContextMenu}
                      onDragOver={handlers.handleDragOver}
                      onDragLeave={(event) => handlers.handleDragLeave(event)}
                      onDrop={handlers.handleDrop}
                      onDragStart={handlers.handleDragStart}
                      onDragEnd={handlers.handleDragEnd}
                      onFolderDragStart={handlers.handleFolderDragStart}
                      onFolderDragEnd={handlers.handleFolderDragEnd}
                      onDocumentClick={handlers.handleDocumentClick}
                      onInlineFolderSubmit={async (name, parentFolderId) => {
                        await handlers.handleInlineFolderSubmit(name, parentFolderId);
                        setInlineInput(null);
                      }}
                      onInlineCancel={() => setInlineInput(null)}
                      onRenameSubmit={async (folderId, newName) => {
                        await handlers.handleRenameFolder(folderId, newName);
                        setRenamingFolderId(null);
                      }}
                      onRenameCancel={() => setRenamingFolderId(null)}
                    />
                  </div>
                </section>
              </>
            )}
          </div>

          <ProfileBar
            user={user}
            onSignOut={handleLogoutClick}
            onNavigateSettings={() => handleViewNavigation('/settings')}
          />
        </div>

        {isOpen && (
          <SidebarResizeHandle
            isMobile={isMobile}
            sidebarWidth={sidebarWidth}
            onResizeStart={() => setIsResizing(true)}
            onResizeEnd={() => setIsResizing(false)}
          />
        )}
      </aside>

      {contextMenu && (contextMenu.type === 'document' || contextMenu.type === 'trash-document') && createPortal(
        <DocumentContextMenu
          contextMenu={{
            x: contextMenu.x,
            y: contextMenu.y,
            type: contextMenu.type,
            documentId: contextMenu.documentId,
          }}
          contextMenuRef={contextMenuRef}
          onAddFolder={contextMenuHandlers.handleAddFolder}
          onAddDocument={contextMenuHandlers.handleAddDocument}
          onRenameDocument={contextMenuHandlers.handleRenameDocument}
          onMakePublicDocument={() => {
            if (contextMenu?.documentId) {
              void publicShareModal.openDocument(contextMenu.documentId);
              closeContextMenu();
            }
          }}
          onAddToBoard={contextMenuHandlers.handleAddToBoard}
          onDeleteDocument={contextMenuHandlers.handleDeleteDocument}
          onRestoreDocument={contextMenuHandlers.handleRestoreDocument}
          onPermanentlyDeleteDocument={contextMenuHandlers.handlePermanentlyDeleteDocument}
          onExportDocument={contextMenuHandlers.handleExportDocument}
          onClose={closeContextMenu}
          isClosing={isClosingContextMenu}
        />,
        document.body
      )}

      {contextMenu && (contextMenu.type === 'empty' || contextMenu.type === 'folder' || contextMenu.type === 'trash-folder') && createPortal(
        <FolderContextMenu
          contextMenu={{
            x: contextMenu.x,
            y: contextMenu.y,
            type: contextMenu.type,
            folderId: contextMenu.folderId,
            folderName: contextMenu.folderName,
          }}
          contextMenuRef={contextMenuRef}
          onAddFolder={contextMenuHandlers.handleAddFolder}
          onAddDocument={contextMenuHandlers.handleAddDocument}
          onRenameFolder={contextMenuHandlers.handleRenameFolder}
          onMakePublicFolder={() => {
            if (contextMenu?.folderId) {
              void publicShareModal.openFolder(contextMenu.folderId);
              closeContextMenu();
            }
          }}
          onDeleteFolder={contextMenuHandlers.handleDeleteFolder}
          onRestoreFolder={contextMenuHandlers.handleRestoreFolder}
          onPermanentlyDeleteFolder={contextMenuHandlers.handlePermanentlyDeleteFolder}
          onExportFolder={contextMenuHandlers.handleExportFolder}
          onClose={closeContextMenu}
          isClosing={isClosingContextMenu}
        />,
        document.body
      )}

      <SidebarDialogs
        showUnsavedDialog={showUnsavedDialog}
        onUnsavedSave={async () => {
          await handlers.handleUnsavedDialogSave(
            pendingDocument as any,
            (doc) => setPendingDocument(doc as any)
          );
          setShowUnsavedDialog(false);
        }}
        onUnsavedDiscard={() => {
          handlers.handleUnsavedDialogDiscard(
            pendingDocument as any,
            (doc) => setPendingDocument(doc as any)
          );
          setShowUnsavedDialog(false);
        }}
        onUnsavedCancel={() => {
          setShowUnsavedDialog(false);
          setPendingDocument(null);
        }}
        showDeleteDialog={showDeleteDialog}
        deleteDialogConfig={deleteDialogConfig}
        onDeleteCancel={closeDeleteDialog}
        showLogoutDialog={showLogoutDialog}
        onLogoutConfirm={handleLogoutConfirm}
        onLogoutCancel={() => setShowLogoutDialog(false)}
      />

      <PublicShareModal
        target={publicShareModal.target}
        isOpen={publicShareModal.isOpen}
        isSaving={publicShareModal.isSaving}
        onClose={publicShareModal.close}
        onSave={publicShareModal.save}
      />
    </>
  );
}
