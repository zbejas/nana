import { createPortal } from 'react-dom';
import { useMemo, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAtomValue, useSetAtom } from 'jotai';
import {
  ArchiveBoxIcon,
  CalendarDaysIcon,
  ChevronDownIcon,
  MagnifyingGlassIcon,
  PlusIcon,
} from '@heroicons/react/24/outline';
import type { Board, BoardSummary } from '../lib/boards';
import type { Document } from '../lib/documents';
import { deleteDocument } from '../lib/documents';
import {
  addToBoardRequestAtom,
  foldersAtom,
  refreshTriggerAtom,
  selectDocumentAtom,
  startNewDocumentAtom,
} from '../state/atoms';
import { exportDocument } from '../lib/export';
import type { FolderTreeNode } from '../lib/folders';
import { useToasts } from '../state/hooks';
import { CalendarFilterPanel } from '../components/timeline/CalendarFilterPanel';
import { TimelineBoardCard } from '../components/timeline/TimelineBoardCard';
import { TimelineDocumentCard } from '../components/timeline/TimelineDocumentCard';
import { NewContentMenu } from '../components/NewContentMenu';
import { BoardDialog } from '../components/board/BoardDialog';
import { createLogger } from '../lib/logger';

const log = createLogger('Timeline');
import { useTimelinePageState } from '../components/timeline/useTimelinePageState';
import { useContextMenuState } from '../components/file-folder-handling';
import { BoardContextMenu } from '../components/file-folder-handling/context-menu/BoardContextMenu';
import { DocumentContextMenu } from '../components/file-folder-handling/context-menu/DocumentContextMenu';
import { PublicShareModal } from '../components/modals/PublicShareModal';
import { usePublicShareModalState } from '../components/modals/usePublicShareModalState';
import { Button, Card, ConfirmDialog, EmptyState, Input, PageHeader, PageShell, SegmentedControl, Spinner } from '../components/ui';

export function TimelinePage() {
  const navigate = useNavigate();
  const selectDocument = useSetAtom(selectDocumentAtom);
  const startNewDocument = useSetAtom(startNewDocumentAtom);
  const setAddToBoardRequest = useSetAtom(addToBoardRequestAtom);
  const setRefreshTrigger = useSetAtom(refreshTriggerAtom);
  const folders = useAtomValue(foldersAtom);
  const { showToast } = useToasts();
  const publicShareModal = usePublicShareModalState();
  const [deleteConfirmState, setDeleteConfirmState] = useState<{ id: string; title: string } | null>(null);
  const [newMenuOpen, setNewMenuOpen] = useState(false);
  const [boardDialogOpen, setBoardDialogOpen] = useState(false);
  const [editingBoard, setEditingBoard] = useState<BoardSummary | null>(null);
  const newButtonRef = useRef<HTMLButtonElement>(null);
  const { contextMenu, isClosingContextMenu, setContextMenu, contextMenuRef, closeContextMenu } = useContextMenuState();
  const {
    groups,
    counts,
    searchQuery,
    setSearchQuery,
    viewMode,
    feedFilter,
    setFeedFilter,
    visibleItemCount,
    isCalendarOpen,
    isMobile,
    isTimelineLoading,
    isLoadingMore,
    isCalendarLoading,
    timelineError,
    calendarError,
    calendarVisibleMonth,
    calendarDays,
    normalizedCalendarRange,
    hasPendingCalendarChanges,
    loadMoreRef,
    calendarPopupRef,
    calendarTriggerRef,
    toggleCalendar,
    resetTimeline,
    selectCalendarDay,
    applyCalendarFilter,
    previousMonth,
    nextMonth,
    clearCalendarSelection,
    loadTimelineFirstPage,
    getWordCount,
    getReadingTime,
    removeDocumentFromTimeline,
    replaceBoardFromTimeline,
    removeBoardFromTimeline,
  } = useTimelinePageState();

  const handleDocumentClick = (document: Document) => {
    selectDocument(document);
    navigate(`/document/${document.id}`);
  };

  const handleBoardClick = (boardId: string) => {
    navigate(`/board/${boardId}`);
  };

  const findBoardInTimeline = (boardId?: string): BoardSummary | undefined => {
    if (!boardId) return undefined;

    for (const group of groups) {
      for (const item of group.items) {
        if (item.kind === 'board' && item.board.id === boardId) {
          return item.board;
        }
      }
    }

    return undefined;
  };

  const handleOpenCreateBoard = () => {
    setEditingBoard(null);
    setBoardDialogOpen(true);
  };

  const handleOpenEditBoard = (board: BoardSummary) => {
    setEditingBoard(board);
    setBoardDialogOpen(true);
    closeContextMenu();
  };

  const handleBoardSaved = (board: Board) => {
    const wasEditing = Boolean(editingBoard);
    setBoardDialogOpen(false);
    setEditingBoard(null);
    replaceBoardFromTimeline(board);
    showToast(wasEditing ? 'Board saved' : 'Board created', 'success');

    if (!wasEditing) {
      navigate(`/board/${board.id}`);
    }
  };

  const handleBoardArchived = (board: Board) => {
    setBoardDialogOpen(false);
    setEditingBoard(null);
    removeBoardFromTimeline(board.id);
    showToast('Board archived', 'info');
  };

  const handleBoardContextMenu = (event: MouseEvent<HTMLDivElement>, board: BoardSummary) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      type: 'board',
      boardId: board.id,
      boardName: board.name,
    });
  };

  const handleOpenBoardItemMenu = (
    event: MouseEvent<HTMLButtonElement>,
    board: BoardSummary,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    setContextMenu({
      x: rect.right,
      y: rect.bottom + 4,
      type: 'board',
      boardId: board.id,
      boardName: board.name,
    });
  };

  const handleBoardLongPressMenu = (board: BoardSummary, position: { x: number; y: number }) => {
    setContextMenu({
      x: position.x,
      y: position.y,
      type: 'board',
      boardId: board.id,
      boardName: board.name,
    });
  };

  const handleCreateFirstDocument = () => {
    startNewDocument({ initialTitle: '', initialContent: '' });
    navigate('/document/new');
  };

  const handleCreateDocument = () => {
    startNewDocument({ initialTitle: '', initialContent: '' });
    navigate('/document/new');
  };

  const handleDocumentContextMenu = (event: MouseEvent<HTMLDivElement>, document: Document) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      type: 'document',
      documentId: document.id,
    });
  };

  const handleOpenItemMenu = (event: MouseEvent<HTMLButtonElement>, document: Document) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    setContextMenu({
      x: rect.right,
      y: rect.bottom + 4,
      type: 'document',
      documentId: document.id,
    });
  };

  const handleLongPressMenu = (document: Document, position: { x: number; y: number }) => {
    setContextMenu({
      x: position.x,
      y: position.y,
      type: 'document',
      documentId: document.id,
    });
  };

  const handleDeleteDocument = () => {
    if (!contextMenu?.documentId) return;

    const contextItem = groups
      .flatMap((group) => group.items)
      .find((item) => item.kind === 'document' && item.document.id === contextMenu.documentId);

    setDeleteConfirmState({
      id: contextMenu.documentId,
      title: contextItem?.kind === 'document' ? contextItem.document.title || 'Untitled' : 'Untitled',
    });
    closeContextMenu();
  };

  const handleConfirmDelete = async () => {
    if (!deleteConfirmState) return;

    try {
      await deleteDocument(deleteConfirmState.id);
      removeDocumentFromTimeline(deleteConfirmState.id);
      setDeleteConfirmState(null);
      setRefreshTrigger((previous) => previous + 1);
      showToast('Note moved to trash', 'info');
    } catch (error) {
      log.error('Failed to delete timeline document', error);
      showToast('Failed to move the note to trash', 'error');
    }
  };

  const handleExportDocument = async () => {
    if (!contextMenu?.documentId) return;

    try {
      await exportDocument(contextMenu.documentId);
    } catch (error) {
      log.error('Failed to export timeline document', error);
      showToast('Failed to export the note', 'error');
    } finally {
      closeContextMenu();
    }
  };

  const handleAddToBoard = () => {
    const documentId = contextMenu?.documentId;
    if (!documentId) return;

    setAddToBoardRequest({ documentId });
    closeContextMenu();
  };

  const folderNameById = useMemo(() => {
    const names = new Map<string, string>();

    const walk = (nodes: FolderTreeNode[]) => {
      nodes.forEach((node) => {
        names.set(node.id, node.name);
        if (node.subfolders.length > 0) {
          walk(node.subfolders);
        }
      });
    };

    walk(folders);
    return names;
  }, [folders]);

  const isLoading = viewMode === 'timeline' ? isTimelineLoading : isCalendarLoading;
  const totalVisible = visibleItemCount;

  const searchField = (
    <div className="relative">
      <MagnifyingGlassIcon className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
      <Input
        type="text"
        value={searchQuery}
        onChange={(event) => setSearchQuery(event.target.value)}
        placeholder="Search notes and boards"
        aria-label="Search notes and boards"
        className="h-9 rounded-control border-line bg-surface pl-10 text-[13px]"
      />
    </div>
  );

  return (
    <PageShell contentClassName="desktop-page-content-enter">
      <PageHeader
          eyebrow="Library"
          title="Timeline"
          description="Everything you have touched — notes and boards, newest first. Search it, filter by date, or start something new."
          actions={
            <>
              <Button
                ref={calendarTriggerRef}
                variant="secondary"
                className="xl:hidden"
                icon={<CalendarDaysIcon />}
                onClick={toggleCalendar}
                aria-expanded={isCalendarOpen}
              >
                Dates
              </Button>
              <Button
                ref={newButtonRef}
                variant="primary"
                icon={<PlusIcon />}
                iconRight={<ChevronDownIcon />}
                onClick={() => setNewMenuOpen((open) => !open)}
                aria-haspopup="menu"
                aria-expanded={newMenuOpen}
              >
                New
              </Button>
            </>
          }
        />

        <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_20rem] lg:gap-10">
          <main className="min-w-0">
            <div className="mb-4 xl:hidden">{searchField}</div>

            <div className="mb-4 flex flex-wrap items-center gap-2">
              <SegmentedControl
                size="sm"
                label="Show in timeline"
                value={feedFilter}
                onChange={setFeedFilter}
                options={[
                  {
                    value: 'all',
                    label: `All ${counts.documents + counts.boards}`,
                    title: 'Show notes and boards',
                  },
                  {
                    value: 'notes',
                    label: `Notes ${counts.documents}`,
                    title: 'Show notes only',
                  },
                  {
                    value: 'boards',
                    label: `Boards ${counts.boards}`,
                    title: 'Show boards only',
                  },
                ]}
              />
            </div>

            <div
              ref={calendarPopupRef}
              className={`overflow-hidden transition-all duration-200 ease-out xl:hidden ${
                isCalendarOpen ? "mb-4 max-h-[36rem] opacity-100" : "mb-0 max-h-0 opacity-0"
              }`}
            >
              <Card className="p-4">
                <CalendarFilterPanel
                  visibleMonth={calendarVisibleMonth}
                  calendarDays={calendarDays}
                  selectedRange={normalizedCalendarRange}
                  hasPendingChanges={hasPendingCalendarChanges}
                  onPreviousMonth={previousMonth}
                  onNextMonth={nextMonth}
                  onDayClick={selectCalendarDay}
                  onApply={applyCalendarFilter}
                  onClear={clearCalendarSelection}
                  onResetTimeline={viewMode === "calendar" ? resetTimeline : undefined}
                  error={calendarError}
                />
              </Card>
            </div>

            {isLoading ? (
              <div className="space-y-3">
                {[0, 1, 2].map((index) => (
                  <div key={index} className="animate-pulse rounded-panel border border-line bg-surface p-4">
                    <div className="flex items-start gap-3">
                      <div className="h-8 w-8 rounded-full bg-surface-raised" />
                      <div className="flex-1 space-y-2">
                        <div className="h-3.5 w-2/5 rounded bg-surface-raised" />
                        <div className="h-2.5 w-1/4 rounded bg-surface-raised/70" />
                      </div>
                    </div>
                    <div className="mt-4 space-y-2">
                      <div className="h-2.5 w-full rounded bg-surface-raised/60" />
                      <div className="h-2.5 w-4/5 rounded bg-surface-raised/50" />
                    </div>
                  </div>
                ))}
              </div>
            ) : viewMode === 'timeline' && timelineError ? (
              <EmptyState
                title="The timeline could not load"
                description={timelineError}
                action={
                  <Button variant="secondary" onClick={() => void loadTimelineFirstPage()}>
                    Try again
                  </Button>
                }
              />
            ) : groups.length === 0 ? (
              searchQuery.trim() ? (
                <EmptyState
                  title="Nothing matches that search"
                  description="Try a shorter phrase, or clear the search to see everything again."
                  action={
                    <Button variant="secondary" onClick={() => setSearchQuery('')}>
                      Clear search
                    </Button>
                  }
                />
              ) : viewMode === 'calendar' ? (
                <EmptyState
                  title="Nothing in that date range"
                  description="Try a wider range, or reset the timeline to see everything again."
                  action={
                    <Button variant="secondary" onClick={resetTimeline}>
                      Reset timeline
                    </Button>
                  }
                />
              ) : feedFilter === 'boards' ? (
                <EmptyState
                  title="No boards yet"
                  description="Create a board to keep work beside your notes. Boards you touch show up here too."
                  action={
                    <Button
                      variant="primary"
                      icon={<PlusIcon />}
                      onClick={handleOpenCreateBoard}
                    >
                      Create board
                    </Button>
                  }
                />
              ) : feedFilter === 'notes' ? (
                <EmptyState
                  eyebrow="A blank page"
                  title="No notes yet"
                  description="Write in Markdown, keep the work beside it on the board, and share it when it is ready."
                  action={
                    <Button variant="primary" icon={<PlusIcon />} onClick={handleCreateFirstDocument}>
                      Create a note
                    </Button>
                  }
                />
              ) : (
                <EmptyState
                  eyebrow="A blank page"
                  title="Start your first note"
                  description="Write in Markdown, keep the work beside it on the board, and share it when it is ready."
                  action={
                    <Button variant="primary" icon={<PlusIcon />} onClick={handleCreateFirstDocument}>
                      Create a note
                    </Button>
                  }
                />
              )
            ) : (
              <div className="space-y-8">
                {searchQuery.trim() && (
                  <p className="text-xs text-ink-muted">
                    {totalVisible} {totalVisible === 1 ? 'result' : 'results'} matching “{searchQuery.trim()}”
                  </p>
                )}

                {groups.map((group) => (
                  <section key={group.label}>
                    <div className="mb-3 flex items-center gap-3">
                      <h2 className="text-[12.5px] font-semibold tracking-[-0.005em] text-ink-secondary">
                        {group.label}
                      </h2>
                      <span className="h-px flex-1 bg-line" aria-hidden="true" />
                      <span className="text-[11.5px] font-medium tabular-nums text-ink-muted">
                        {group.items.length}
                      </span>
                    </div>
                    <div className="space-y-3">
                      {group.items.map((item) =>
                        item.kind === 'document' ? (
                          <TimelineDocumentCard
                            key={item.id}
                            document={item.document}
                            isMobile={isMobile}
                            folderName={
                              item.document.folder
                                ? folderNameById.get(item.document.folder)
                                : undefined
                            }
                            highlightQuery={searchQuery}
                            onClick={() => handleDocumentClick(item.document)}
                            onContextMenu={(event) =>
                              handleDocumentContextMenu(event, item.document)
                            }
                            onOpenItemMenu={(event) =>
                              handleOpenItemMenu(event, item.document)
                            }
                            onLongPressMenu={(position) =>
                              handleLongPressMenu(item.document, position)
                            }
                            wordCount={getWordCount(item.document)}
                            readingTime={getReadingTime(item.document)}
                          />
                        ) : (
                          <TimelineBoardCard
                            key={item.id}
                            board={item.board}
                            folderName={
                              item.board.folder
                                ? folderNameById.get(item.board.folder)
                                : undefined
                            }
                            highlightQuery={searchQuery}
                            onClick={() => handleBoardClick(item.board.id)}
                            onContextMenu={(event) =>
                              handleBoardContextMenu(event, item.board)
                            }
                            onOpenItemMenu={(event) =>
                              handleOpenBoardItemMenu(event, item.board)
                            }
                            onLongPressMenu={(position) =>
                              handleBoardLongPressMenu(item.board, position)
                            }
                          />
                        )
                      )}
                    </div>
                  </section>
                ))}

                {viewMode === 'timeline' && feedFilter !== 'boards' && (
                  <>
                    <div ref={loadMoreRef} className="h-2" />
                    {isLoadingMore && (
                      <div className="flex items-center justify-center gap-2 py-4 text-xs text-ink-muted">
                        <Spinner className="h-3.5 w-3.5" />
                        Loading more notes
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </main>

          <aside className="hidden xl:block">
            <div className="sticky top-0 space-y-4">
              {searchField}

              <Card className="p-4">
                <CalendarFilterPanel
                  visibleMonth={calendarVisibleMonth}
                  calendarDays={calendarDays}
                  selectedRange={normalizedCalendarRange}
                  hasPendingChanges={hasPendingCalendarChanges}
                  onPreviousMonth={previousMonth}
                  onNextMonth={nextMonth}
                  onDayClick={selectCalendarDay}
                  onApply={applyCalendarFilter}
                  onClear={clearCalendarSelection}
                  onResetTimeline={viewMode === 'calendar' ? resetTimeline : undefined}
                  error={calendarError}
                />
              </Card>

              <Card className="overflow-hidden p-0">
                <div className="p-4">
                  <p className="text-[11.5px] font-semibold text-ink-muted">In this view</p>
                  <dl className="mt-3 grid grid-cols-3 gap-2">
                    <div className="rounded-[8px] bg-surface-sunken px-2.5 py-2.5">
                      <dt className="text-[11.5px] font-medium text-ink-muted">Notes</dt>
                      <dd className="mt-0.5 text-[20px] font-medium tabular-nums tracking-[-0.02em] text-ink">{counts.documents}</dd>
                    </div>
                    <div className="rounded-[8px] bg-surface-sunken px-2.5 py-2.5">
                      <dt className="text-[11.5px] font-medium text-ink-muted">Boards</dt>
                      <dd className="mt-0.5 text-[20px] font-medium tabular-nums tracking-[-0.02em] text-ink">{counts.boards}</dd>
                    </div>
                    <div className="rounded-[8px] bg-surface-sunken px-2.5 py-2.5">
                      <dt className="text-[11.5px] font-medium text-ink-muted">Folders</dt>
                      <dd className="mt-0.5 text-[20px] font-medium tabular-nums tracking-[-0.02em] text-ink">{folders.length}</dd>
                    </div>
                  </dl>
                </div>
                <button
                  type="button"
                  onClick={() => navigate('/board/archive')}
                  className="group flex w-full items-center gap-3 border-t border-line px-4 py-3 text-left transition-colors hover:bg-surface-raised"
                >
                  <span className="flex h-8 w-8 items-center justify-center rounded-[7px] bg-surface-sunken text-ink-muted">
                    <ArchiveBoxIcon className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[12.5px] font-medium text-ink">Archived boards</span>
                    <span className="mt-0.5 block truncate text-[11.5px] text-ink-muted">
                      Restore or delete boards you set aside
                    </span>
                  </span>
                  <span className="text-ink-muted transition-colors group-hover:text-ink" aria-hidden="true">
                    →
                  </span>
                </button>
              </Card>
            </div>
          </aside>
        </div>

      {contextMenu && contextMenu.type === 'document' &&
        createPortal(
          <DocumentContextMenu
            mode="timeline"
            contextMenu={{
              x: contextMenu.x,
              y: contextMenu.y,
              type: 'document',
              documentId: contextMenu.documentId,
            }}
            contextMenuRef={contextMenuRef}
            onAddFolder={() => undefined}
            onAddDocument={() => undefined}
            onRenameDocument={() => undefined}
            onMakePublicDocument={() => {
              if (contextMenu?.documentId) {
                void publicShareModal.openDocument(contextMenu.documentId);
                closeContextMenu();
              }
            }}
            onAddToBoard={handleAddToBoard}
            onDeleteDocument={handleDeleteDocument}
            onRestoreDocument={() => undefined}
            onPermanentlyDeleteDocument={() => undefined}
            onExportDocument={handleExportDocument}
            onClose={closeContextMenu}
            isClosing={isClosingContextMenu}
          />,
          document.body
        )}

      {contextMenu?.type === 'board' &&
        createPortal(
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
              const board = findBoardInTimeline(contextMenu.boardId);
              closeContextMenu();
              if (board) {
                handleBoardClick(board.id);
              }
            }}
            onEditBoard={() => {
              const board = findBoardInTimeline(contextMenu.boardId);
              if (board) {
                handleOpenEditBoard(board);
              } else {
                closeContextMenu();
              }
            }}
            onShareBoard={() => {
              if (contextMenu.boardId) {
                void publicShareModal.openBoard(contextMenu.boardId);
                closeContextMenu();
              }
            }}
            onClose={closeContextMenu}
            isClosing={isClosingContextMenu}
          />,
          document.body
        )}

      <ConfirmDialog
        open={Boolean(deleteConfirmState)}
        title="Move this note to trash?"
        description={
          deleteConfirmState
            ? `“${deleteConfirmState.title}” will be moved to trash. You can restore it later.`
            : undefined
        }
        confirmLabel="Move to trash"
        tone="danger"
        onConfirm={() => void handleConfirmDelete()}
        onCancel={() => setDeleteConfirmState(null)}
      />

      <PublicShareModal
        target={publicShareModal.target}
        isOpen={publicShareModal.isOpen}
        isSaving={publicShareModal.isSaving}
        onClose={publicShareModal.close}
        onSave={publicShareModal.save}
      />

      <NewContentMenu
        open={newMenuOpen}
        anchorRect={newButtonRef.current?.getBoundingClientRect() ?? null}
        onClose={() => setNewMenuOpen(false)}
        onCreateNote={handleCreateDocument}
        onCreateBoard={handleOpenCreateBoard}
      />

      <BoardDialog
        open={boardDialogOpen}
        board={editingBoard}
        taskCount={editingBoard ? editingBoard.total : undefined}
        onClose={() => {
          setBoardDialogOpen(false);
          setEditingBoard(null);
        }}
        onSaved={handleBoardSaved}
        onArchived={handleBoardArchived}
      />
    </PageShell>
  );
}
