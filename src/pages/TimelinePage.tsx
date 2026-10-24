import { createPortal } from 'react-dom';
import { useMemo, useState } from 'react';
import type { MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAtomValue, useSetAtom } from 'jotai';
import {
  CalendarDaysIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  ViewColumnsIcon,
} from '@heroicons/react/24/outline';
import type { Document } from '../lib/documents';
import { deleteDocument } from '../lib/documents';
import {
  addToBoardRequestAtom,
  foldersAtom,
  selectDocumentAtom,
  startNewDocumentAtom,
} from '../state/atoms';
import { exportDocument } from '../lib/export';
import type { FolderTreeNode } from '../lib/folders';
import { useToasts } from '../state/hooks';
import { CalendarFilterPanel } from '../components/timeline/CalendarFilterPanel';
import { TimelineDocumentCard } from '../components/timeline/TimelineDocumentCard';
import { createLogger } from '../lib/logger';

const log = createLogger('Timeline');
import { useTimelinePageState } from '../components/timeline/useTimelinePageState';
import { useContextMenuState } from '../components/file-folder-handling';
import { DocumentContextMenu } from '../components/file-folder-handling/context-menu/DocumentContextMenu';
import { PublicShareModal } from '../components/modals/PublicShareModal';
import { usePublicShareModalState } from '../components/modals/usePublicShareModalState';
import { Button, Card, ConfirmDialog, EmptyState, Input, PageHeader, Spinner } from '../components/ui';

export function TimelinePage() {
  const navigate = useNavigate();
  const selectDocument = useSetAtom(selectDocumentAtom);
  const startNewDocument = useSetAtom(startNewDocumentAtom);
  const setAddToBoardRequest = useSetAtom(addToBoardRequestAtom);
  const folders = useAtomValue(foldersAtom);
  const { showToast } = useToasts();
  const publicShareModal = usePublicShareModalState();
  const [deleteConfirmState, setDeleteConfirmState] = useState<{ id: string; title: string } | null>(null);
  const { contextMenu, isClosingContextMenu, setContextMenu, contextMenuRef, closeContextMenu } = useContextMenuState();
  const {
    groups,
    searchQuery,
    setSearchQuery,
    viewMode,
    isCalendarOpen,
    isMobile,
    isInitialLoading,
    isLoadingMore,
    isCalendarLoading,
    isSearchLoading,
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
  } = useTimelinePageState();

  const handleDocumentClick = (document: Document) => {
    selectDocument(document);
    navigate(`/document/${document.id}`);
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

    const contextDocument = groups
      .flatMap((group) => group.items)
      .find((document) => document.id === contextMenu.documentId);

    setDeleteConfirmState({
      id: contextMenu.documentId,
      title: contextDocument?.title || 'Untitled',
    });
    closeContextMenu();
  };

  const handleConfirmDelete = async () => {
    if (!deleteConfirmState) return;

    try {
      await deleteDocument(deleteConfirmState.id);
      removeDocumentFromTimeline(deleteConfirmState.id);
      setDeleteConfirmState(null);
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

  const isLoading = viewMode === 'timeline' ? isInitialLoading || isSearchLoading : isCalendarLoading;
  const totalVisible = groups.reduce((count, group) => count + group.items.length, 0);

  const searchField = (
    <div className="relative">
      <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
      <Input
        type="text"
        value={searchQuery}
        onChange={(event) => setSearchQuery(event.target.value)}
        placeholder="Search your notes"
        aria-label="Search documents"
        className="h-9 pl-9 text-[13px]"
      />
    </div>
  );

  return (
    <div className="h-full overflow-y-auto scrollbar-autohide">
      <div className="desktop-page-content-enter mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <PageHeader
          eyebrow="Library"
          title="Timeline"
          description="Everything you have touched, newest first. Search it, filter by date, or start something new."
          actions={
            <>
              <Button
                ref={calendarTriggerRef}
                variant="secondary"
                className="lg:hidden"
                icon={<CalendarDaysIcon />}
                onClick={toggleCalendar}
                aria-expanded={isCalendarOpen}
              >
                Dates
              </Button>
              <Button variant="primary" icon={<PlusIcon />} onClick={handleCreateDocument}>
                New note
              </Button>
            </>
          }
        />

        <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <main className="min-w-0">
            <div className="mb-4 lg:hidden">{searchField}</div>

            <div
              ref={calendarPopupRef}
              className={`overflow-hidden transition-all duration-200 ease-out lg:hidden ${
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
                  title="No notes match that search"
                  description="Try a shorter phrase, or clear the search to see everything again."
                  action={
                    <Button variant="secondary" onClick={() => setSearchQuery('')}>
                      Clear search
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
                  className="border-b-0"
                />
              )
            ) : (
              <div className="space-y-8">
                {searchQuery.trim() && (
                  <p className="text-xs text-ink-muted">
                    {totalVisible} {totalVisible === 1 ? 'note' : 'notes'} matching “{searchQuery.trim()}”
                  </p>
                )}

                {groups.map((group) => (
                  <section key={group.label}>
                    <div className="mb-3 flex items-center gap-3">
                      <h2 className="eyebrow">{group.label}</h2>
                      <span className="h-px flex-1 bg-line" aria-hidden="true" />
                      <span className="text-[10px] tabular-nums text-ink-muted">{group.items.length}</span>
                    </div>
                    <div className="space-y-2.5">
                      {group.items.map((document) => (
                        <TimelineDocumentCard
                          key={document.id}
                          document={document}
                          isMobile={isMobile}
                          folderName={document.folder ? folderNameById.get(document.folder) : undefined}
                          highlightQuery={searchQuery}
                          onClick={() => handleDocumentClick(document)}
                          onContextMenu={(event) => handleDocumentContextMenu(event, document)}
                          onOpenItemMenu={(event) => handleOpenItemMenu(event, document)}
                          onLongPressMenu={(position) => handleLongPressMenu(document, position)}
                          wordCount={getWordCount(document)}
                          readingTime={getReadingTime(document)}
                        />
                      ))}
                    </div>
                  </section>
                ))}

                {viewMode === 'timeline' && (
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

          <aside className="hidden lg:block">
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

              <Card className="p-4">
                <div className="flex h-8 w-8 items-center justify-center rounded-full border border-signal/25 bg-signal-soft text-signal">
                  <ViewColumnsIcon className="h-4 w-4" />
                </div>
                <h3 className="mt-3 font-display text-base text-ink">Notes become work</h3>
                <p className="mt-1 text-xs leading-relaxed text-ink-secondary">
                  Right-click any note and choose “Add to board” to turn it into a task without losing the writing.
                </p>
                <Button variant="ghost" size="sm" className="mt-2 px-0" onClick={() => navigate('/board')}>
                  Open boards →
                </Button>
              </Card>
            </div>
          </aside>
        </div>
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
    </div>
  );
}
