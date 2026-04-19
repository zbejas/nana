import { useMemo } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAtomValue, useSetAtom } from "jotai";
import {
  ClockIcon,
  FolderIcon,
  ChatBubbleLeftRightIcon,
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
import { SidebarFooter } from "./sidebar/SidebarLogo";
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
import { useSidebarWidth, useLowPowerMode } from "../lib/settings";

const noopLoadFolderDocuments = async (_folderId: string, _isTrash?: boolean) => {};

export function Sidebar() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const sidebarHook = useSidebar();
  const { isResizing, setIsResizing } = sidebarHook;
  
  // Access data from atoms (initialized by App.tsx's useDocumentData call)
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

  // Get lazy loading data from atoms (managed by App.tsx's useDocumentData)
  const loadedFolders = useAtomValue(loadedFoldersAtom);
  const loadingFolders = useAtomValue(loadingFoldersAtom);
  const loadFolderDocuments = useAtomValue(loadFolderDocumentsAtom) ?? noopLoadFolderDocuments;

  const sidebarWidth = useSidebarWidth();
  const lowPowerMode = useLowPowerMode();

  const { isOpen, toggle } = sidebarHook;

  // State hooks (must be before useSidebarHandlers since it needs prepareForNavigation)
  const { isMobile, swipeStartX, setSwipeStartX, swipeCurrentX, setSwipeCurrentX, prepareForNavigation } = useMobileState(isOpen, toggle);

  // Get handlers from custom hook
  const handlers = useSidebarHandlers({
    editorActions: {
      select,
      startNew,
      saveCallback,
      reset,
    },
    sidebarActions: {
      toggle,
      prepareForNavigation,
    },
    dataHook: {
      expandedFolders,
      toggleFolder,
    },
  });

  // Get top 2 recent documents for sidebar
  const recentDocuments = useMemo(() => {
    return allRecentDocuments.slice(0, 2);
  }, [allRecentDocuments]);

  // State hooks
  const { contextMenu, isClosingContextMenu, contextMenuRef, handleContextMenu, closeContextMenu } = useContextMenuState();
  const { inlineInput, setInlineInput, renamingFolderId, setRenamingFolderId } = useInlineInputState();
  const { 
    showUnsavedDialog, setShowUnsavedDialog, pendingDocument, setPendingDocument,
    showDeleteDialog, deleteDialogConfig, openDeleteDialog, closeDeleteDialog,
    showLogoutDialog, setShowLogoutDialog 
  } = useDialogState();
  const publicShareModal = usePublicShareModalState();

  // Context menu handlers
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

  const handleLogoutClick = () => {
    setShowLogoutDialog(true);
  };

  const handleLogoutConfirm = () => {
    signOut();
    setShowLogoutDialog(false);
    navigate('/');
  };

  const viewLinks = [
    { key: 'timeline', label: 'Timeline', path: '/timeline', icon: ClockIcon },
    { key: 'folders', label: 'Folder View', path: '/folders', icon: FolderIcon },
    { key: 'chat', label: 'Chat', path: '/chat', icon: ChatBubbleLeftRightIcon },
  ];

  const handleViewNavigation = (path: string) => {
    if (isMobile) {
      prepareForNavigation();
    }
    navigate(path);
    if (isMobile) {
      toggle();
    }
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
        lowPowerMode={lowPowerMode}
      />


      <aside 
        className={`fixed left-0 top-0 h-full md:backdrop-blur-sm border-r flex flex-col z-50 overflow-hidden bg-white/90 dark:bg-black/55 light:bg-white/90 md:bg-black/50 dark:md:bg-black/50 light:md:bg-white/80 border-white/10 dark:border-white/10 light:border-gray-300`}
        style={{
          width: isMobile ? '100%' : `${sidebarWidth}px`,
          transform: isOpen ? 'translateX(0)' : (isMobile ? 'translateX(-100%)' : `translateX(-${sidebarWidth}px)`),
          transition: swipeCurrentX !== null || isResizing ? 'none' : 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        }}
        onContextMenu={(e) => handleContextMenu(e, 'empty')}
        onTouchStart={(e) => {
          if (!isMobile || !isOpen) return;
          const touch = e.touches[0];
          if (touch) {
            setSwipeStartX(touch.clientX);
            setSwipeCurrentX(touch.clientX);
          }
        }}
        onTouchMove={(e) => {
          if (!isMobile || !isOpen || swipeStartX === null) return;
          const touch = e.touches[0];
          if (touch) {
            setSwipeCurrentX(touch.clientX);
            const deltaX = touch.clientX - swipeStartX;
            if (deltaX < -50) e.preventDefault();
          }
        }}
        onTouchEnd={() => {
          if (!isMobile || !isOpen || swipeStartX === null || swipeCurrentX === null) {
            setSwipeStartX(null);
            setSwipeCurrentX(null);
            return;
          }
          const deltaX = swipeCurrentX - swipeStartX;
          if (deltaX < -100) toggle();
          setSwipeStartX(null);
          setSwipeCurrentX(null);
        }}
      >
        <div className="h-full flex flex-col bg-transparent" style={{ width: isMobile ? '100%' : `${sidebarWidth}px` }}>
          <ProfileBar
            user={user}
            onSignOut={handleLogoutClick}
            onNavigateSettings={() => handleViewNavigation('/settings')}
          />

          {/* Scrollable Content Area */}
          <div className="flex-1 overflow-y-auto px-3 pb-0 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-gray-600/0 hover:[&::-webkit-scrollbar-thumb]:bg-gray-600/40 [&::-webkit-scrollbar-thumb]:rounded-full" style={{ scrollbarGutter: 'stable' }}>
            {isDataLoading ? (
              <div className="text-center py-8 text-gray-500 text-sm">Loading...</div>
            ) : (
              <div className="space-y-3 pb-3">
                {/* Search Bar */}
                <SearchBar
                  onDocumentClick={handlers.handleDocumentClick}
                  onContextMenu={(e, documentId) => handleContextMenu(e, 'document', { documentId })}
                />

                {/* Recent Documents */}
                <RecentDocumentsSection
                  documents={recentDocuments}
                  onDocumentClick={handlers.handleDocumentClick}
                  onContextMenu={(e, documentId) => handleContextMenu(e, 'document', { documentId })}
                  isLoading={isDataLoading}
                />
                
                {/* Documents & Folders */}
                <div>
                  <div className="flex items-center px-2 py-1.5">
                    <span className="text-[11px] text-gray-500 uppercase font-semibold tracking-wider">Files</span>
                  </div>
                  <div className="pt-1 space-y-0.5">
                    {/* Root documents (above folders) */}
                    <RootDocumentsSection
                      documents={rootDocuments}
                      isDataLoading={isDataLoading}
                      dropZone={handlers.dropZone}
                      onDocumentClick={handlers.handleDocumentClick}
                      onContextMenu={(e, documentId) => handleContextMenu(e, 'document', { documentId })}
                      onDragStart={handlers.handleDragStart}
                      onDragEnd={handlers.handleDragEnd}
                      onDragOver={handlers.handleDragOver}
                      onDragLeave={(e) => handlers.handleDragLeave(e)}
                      onDrop={handlers.handleDrop}
                      onAddDocument={handlers.handleAddDocument}
                    />

                    {/* Folders */}
                    <FoldersSection
                      folders={folders}
                      isDataLoading={isDataLoading}
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
                      onDragLeave={(e) => handlers.handleDragLeave(e)}
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
                </div>
                
              </div>
            )}
          </div>

          <SidebarFooter
            onToggle={toggle}
            isMobile={isMobile}
            viewLinks={viewLinks}
            currentPath={location.pathname}
            onNavigate={handleViewNavigation}
          />
        </div>
        
        {/* Resize handle for desktop */}
        {isOpen && (
          <SidebarResizeHandle 
            isMobile={isMobile} 
            sidebarWidth={sidebarWidth}
            onResizeStart={() => setIsResizing(true)}
            onResizeEnd={() => setIsResizing(false)}
          />
        )}
      </aside>

      {contextMenu && (contextMenu.type === 'document' || contextMenu.type === 'trash-document') && (
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
          onDeleteDocument={contextMenuHandlers.handleDeleteDocument}
          onRestoreDocument={contextMenuHandlers.handleRestoreDocument}
          onPermanentlyDeleteDocument={contextMenuHandlers.handlePermanentlyDeleteDocument}
          onExportDocument={contextMenuHandlers.handleExportDocument}
          onClose={closeContextMenu}
          isClosing={isClosingContextMenu}
        />
      )}

      {contextMenu && (contextMenu.type === 'empty' || contextMenu.type === 'folder' || contextMenu.type === 'trash-folder') && (
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
        />
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
