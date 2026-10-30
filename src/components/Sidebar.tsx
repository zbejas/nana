import { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useLocation } from "react-router-dom";
import { useAtomValue, useSetAtom } from "jotai";
import {
  ArchiveBoxIcon,
  ClockIcon,
  FolderIcon,
  ChatBubbleLeftRightIcon,
  ViewColumnsIcon,
  XMarkIcon,
  ChevronDoubleLeftIcon,
  ChevronDownIcon,
  PlusIcon,
  FolderPlusIcon,
} from '@heroicons/react/24/outline';
import { useAuth } from "../lib/auth";
import { useSidebar, useToasts } from "../state/hooks";
import { createUntitledBoard, type Board } from "../lib/boards";
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
import { BoardContextMenu } from "./file-folder-handling/context-menu/BoardContextMenu";
import { RecentDocumentsSection } from "./sidebar/RecentDocumentsSection";
import { ProfileBar } from "./sidebar/ProfileBar";
import { SidebarDialogs } from "./sidebar/SidebarDialogs";
import { SearchBar } from "./sidebar/SearchBar";
import { RootLibrarySection } from "./sidebar/RootLibrarySection";
import { FoldersSection } from "./sidebar/FoldersSection";
import { SidebarResizeHandle } from "./sidebar/SidebarResizeHandle";
import { useSidebarBoards } from "./sidebar/useSidebarBoards";
import { NewContentMenu } from "./NewContentMenu";
import { useSidebarHandlers } from "./sidebar/useSidebarHandlers";
import { useInlineInputState } from "./sidebar/useInlineInputState";
import { useDialogState } from "./sidebar/useDialogState";
import { useMobileState } from "./sidebar/useMobileState";
import { CompactSidebar } from "./sidebar/CompactSidebar";
import { useContextMenuState, useContextMenuHandlers } from "./file-folder-handling";
import { PublicSharePanel } from "./modals/PublicSharePanel";
import { usePublicSharePanelState } from "./modals/usePublicSharePanelState";
import { useSidebarWidth } from "../lib/settings";
import { IconButton } from "./ui";
import logo from '../assets/nana.svg';

const noopLoadFolderDocuments = async (_folderId: string, _isTrash?: boolean) => {};

const NAV_ITEMS = [
  { key: 'timeline', label: 'Timeline', path: '/timeline', icon: ClockIcon },
  { key: 'folders', label: 'Folders', path: '/folders', icon: FolderIcon },
  { key: 'chat', label: 'Chat', path: '/chat', icon: ChatBubbleLeftRightIcon },
] as const;

function isNavActive(pathname: string, path: string): boolean {
  if (path === '/timeline') {
    return pathname === '/timeline' || pathname.startsWith('/board');
  }

  return pathname === path || pathname.startsWith(`${path}/`);
}

export function Sidebar() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const sidebarHook = useSidebar();
  const { isResizing, setIsResizing } = sidebarHook;
  const boards = useSidebarBoards();
  const { showToast } = useToasts();
  const [isCreatingBoard, setIsCreatingBoard] = useState(false);
  const [newMenuOpen, setNewMenuOpen] = useState(false);
  const newButtonRef = useRef<HTMLButtonElement>(null);

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
  const rootBoards = useMemo(() => boards.filter((board) => !board.folder), [boards]);
  const activeBoardId = useMemo(() => {
    const match = location.pathname.match(/^\/board\/([^/]+)$/);
    return match?.[1];
  }, [location.pathname]);

  const { contextMenu, isClosingContextMenu, contextMenuRef, handleContextMenu, closeContextMenu } = useContextMenuState();
  const { inlineInput, setInlineInput, renamingFolderId, setRenamingFolderId } = useInlineInputState();
  const {
    showUnsavedDialog, setShowUnsavedDialog, pendingDocument, setPendingDocument,
    showDeleteDialog, deleteDialogConfig, openDeleteDialog, closeDeleteDialog,
    showLogoutDialog, setShowLogoutDialog
  } = useDialogState();
  const publicSharePanel = usePublicSharePanelState();

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

  const handleBoardClick = (board: Board) => {
    handleViewNavigation(`/board/${board.id}`);
  };

  const handleOpenCreateBoard = async (folderId?: string) => {
    if (isCreatingBoard) return;
    setIsCreatingBoard(true);

    try {
      const board = await createUntitledBoard(folderId);
      if (isMobile) {
        prepareForNavigation();
        toggle();
      }
      navigate(`/board/${board.id}`, { state: { editBoard: true, newBoard: true } });
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not create the board.', 'error');
    } finally {
      setIsCreatingBoard(false);
    }
  };

  const handleOpenEditBoard = (board: Board) => {
    closeContextMenu();
    if (isMobile) {
      prepareForNavigation();
      toggle();
    }
    navigate(`/board/${board.id}`, { state: { editBoard: true } });
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

      <NewContentMenu
        open={newMenuOpen}
        anchorRect={newButtonRef.current?.getBoundingClientRect() ?? null}
        onClose={() => setNewMenuOpen(false)}
        onCreateNote={() => void handlers.handleAddDocument()}
        onCreateBoard={() => void handleOpenCreateBoard()}
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
          <div className="px-3 pb-2 pt-3">
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  reset();
                  handleViewNavigation('/timeline');
                }}
                className="-ml-2 flex min-h-11 min-w-0 items-center gap-2 rounded-control text-left md:min-h-0"
                aria-label="Nana home"
              >
                <img src={logo} alt="" className="h-8 w-8 shrink-0" draggable={false} />
                <span className="min-w-0">
                  <span className="block truncate text-[14px] font-semibold leading-none tracking-[-0.02em] text-ink">
                    Nana
                  </span>
                  <span className="mt-1 block truncate text-[11.5px] font-medium leading-none text-ink-muted">
                    Your workspace
                  </span>
                </span>
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

            <button
              ref={newButtonRef}
              type="button"
              onClick={() => setNewMenuOpen((open) => !open)}
              aria-haspopup="menu"
              aria-expanded={newMenuOpen}
              className="mt-3 flex h-9 w-full items-center gap-2 rounded-control bg-ink px-3 text-[13px] font-medium text-canvas transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
            >
              <PlusIcon className="h-4 w-4" aria-hidden="true" />
              New
              <ChevronDownIcon className="ml-auto h-3.5 w-3.5" aria-hidden="true" />
            </button>
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
                  className={`group relative mb-0.5 flex h-8 w-full items-center gap-2.5 rounded-control border px-2.5 text-[13px] font-medium transition-colors ${
                    active
                      ? 'border-line bg-surface text-ink'
                      : 'border-transparent text-ink-secondary hover:bg-surface/70 hover:text-ink'
                  }`}
                >
                  <Icon className={`h-4 w-4 shrink-0 ${active ? 'text-signal' : 'text-ink-muted'}`} />
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
                    <p className="flex-1 text-[11.5px] font-medium text-ink-muted">Library</p>
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
                    <IconButton
                      label="New board"
                      size="sm"
                      className="h-6 w-6 [&>svg]:h-3.5 [&>svg]:w-3.5"
                      onClick={() => void handleOpenCreateBoard()}
                    >
                      <ViewColumnsIcon />
                    </IconButton>
                    <IconButton
                      label="Archived boards"
                      size="sm"
                      className="h-6 w-6 [&>svg]:h-3.5 [&>svg]:w-3.5"
                      onClick={() => handleViewNavigation('/board/archive')}
                    >
                      <ArchiveBoxIcon />
                    </IconButton>
                  </div>

                  <div className="space-y-px">
                    <RootLibrarySection
                      documents={rootDocuments}
                      boards={rootBoards}
                      isDataLoading={isDataLoading}
                      dropZone={handlers.dropZone}
                      activeDocumentId={selectedDocument?.id}
                      activeBoardId={activeBoardId}
                      onDocumentClick={handlers.handleDocumentClick}
                      onDocumentContextMenu={(event, documentId) =>
                        handleContextMenu(event, 'document', { documentId })
                      }
                      onBoardClick={handleBoardClick}
                      onBoardContextMenu={(event, board) =>
                        handleContextMenu(event, 'board', {
                          boardId: board.id,
                          boardName: board.name,
                        })
                      }
                      onDocumentDragStart={handlers.handleDragStart}
                      onDocumentDragEnd={handlers.handleDragEnd}
                      onBoardDragStart={handlers.handleBoardDragStart}
                      onBoardDragEnd={handlers.handleBoardDragEnd}
                      onDragOver={handlers.handleDragOver}
                      onDragLeave={(event) => handlers.handleDragLeave(event)}
                      onDrop={handlers.handleDrop}
                    />

                    <FoldersSection
                      folders={folders}
                      boards={boards}
                      isDataLoading={isDataLoading}
                      activeDocumentId={selectedDocument?.id}
                      activeBoardId={activeBoardId}
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
                      onBoardDragStart={handlers.handleBoardDragStart}
                      onBoardDragEnd={handlers.handleBoardDragEnd}
                      onDocumentClick={handlers.handleDocumentClick}
                      onBoardClick={handleBoardClick}
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
              void publicSharePanel.openDocument(contextMenu.documentId);
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
          onAddBoard={() => {
            const folderId = contextMenu?.type === 'folder' ? contextMenu.folderId : undefined;
            closeContextMenu();
            void handleOpenCreateBoard(folderId);
          }}
          onRenameFolder={contextMenuHandlers.handleRenameFolder}
          onMakePublicFolder={() => {
            if (contextMenu?.folderId) {
              void publicSharePanel.openFolder(contextMenu.folderId);
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

      {contextMenu?.type === 'board' && createPortal(
        <BoardContextMenu
          contextMenu={{
            x: contextMenu.x,
            y: contextMenu.y,
            type: 'board',
            boardId: contextMenu.boardId,
            boardName: contextMenu.boardName,
          }}
          contextMenuRef={contextMenuRef}
          onOpenBoard={() => {
            const board = contextMenu.boardId
              ? boards.find((item) => item.id === contextMenu.boardId)
              : undefined;
            closeContextMenu();
            if (board) {
              handleBoardClick(board);
            }
          }}
          onEditBoard={() => {
            const board = contextMenu.boardId
              ? boards.find((item) => item.id === contextMenu.boardId)
              : undefined;
            if (board) {
              handleOpenEditBoard(board);
            } else {
              closeContextMenu();
            }
          }}
          onShareBoard={() => {
            if (contextMenu.boardId) {
              void publicSharePanel.openBoard(contextMenu.boardId);
              closeContextMenu();
            }
          }}
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

      <PublicSharePanel
        target={publicSharePanel.target}
        isOpen={publicSharePanel.isOpen}
        isSaving={publicSharePanel.isSaving}
        onClose={publicSharePanel.close}
        onSave={publicSharePanel.save}
      />
    </>
  );
}
