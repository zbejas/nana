import { createPortal } from 'react-dom';
import { useMemo, useState } from 'react';
import type { MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAtomValue, useSetAtom } from 'jotai';
import { CalendarDaysIcon, MagnifyingGlassIcon, PlusIcon } from '@heroicons/react/24/outline';
import type { Document } from '../lib/documents';
import { deleteDocument } from '../lib/documents';
import {
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
import { ConfirmDialog } from '../components/modals/ConfirmDialog';
import { PublicShareModal } from '../components/modals/PublicShareModal';
import { usePublicShareModalState } from '../components/modals/usePublicShareModalState';

export function TimelinePage() {
  const usePreviewCardVariant = true;
  const navigate = useNavigate();
  const selectDocument = useSetAtom(selectDocumentAtom);
  const startNewDocument = useSetAtom(startNewDocumentAtom);
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
    if (!contextMenu?.documentId) {
      return;
    }

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
    if (!deleteConfirmState) {
      return;
    }

    try {
      await deleteDocument(deleteConfirmState.id);
      removeDocumentFromTimeline(deleteConfirmState.id);
      setDeleteConfirmState(null);
    } catch (error) {
      log.error('Failed to delete timeline document', error);
      showToast('Failed to move document to trash. Please try again.', 'error');
    }
  };

  const handleExportDocument = async () => {
    if (!contextMenu?.documentId) {
      return;
    }

    try {
      await exportDocument(contextMenu.documentId);
    } catch (error) {
      log.error('Failed to export timeline document', error);
      showToast('Failed to export document. Please try again.', 'error');
    } finally {
      closeContextMenu();
    }
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

  return (
    <div className="h-full overflow-y-auto scrollbar-autohide bg-black/40 backdrop-blur-md p-4 sm:p-6">
      <div className="desktop-page-content-enter relative max-w-7xl mx-auto">
        <div className="pointer-events-none hidden lg:block absolute top-0 bottom-0 right-[22rem] w-px bg-white/10" />
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-0 items-start">
          <div className="min-w-0 max-w-3xl lg:max-w-4xl lg:pr-8">
            <div className="mb-6 flex items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-white">
                  <CalendarDaysIcon className="w-5 h-5 text-blue-400" />
                  <h1 className="text-2xl font-bold text-white">Timeline</h1>
                </div>
                <p className="text-xs text-gray-400 mt-1">Recent activity across your documents.</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleCreateDocument}
                  className="inline-flex items-center justify-center rounded-lg border border-blue-500/30 bg-blue-500/20 p-2 text-blue-100 hover:bg-blue-500/30 transition-colors"
                  title="New document"
                  aria-label="New document"
                >
                  <PlusIcon className="w-5 h-5" />
                </button>
                <button
                  ref={calendarTriggerRef}
                  onClick={toggleCalendar}
                  className={`inline-flex lg:hidden items-center justify-center rounded-lg border p-2 transition-colors ${(isCalendarOpen || viewMode === 'calendar')
                    ? 'border-blue-500/30 bg-blue-500/20 text-blue-100 hover:bg-blue-500/30'
                    : 'border-white/10 bg-white/5 text-gray-200 hover:bg-white/10'
                    }`}
                  title="Open calendar"
                  aria-label="Open calendar"
                >
                  <CalendarDaysIcon className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="lg:hidden mb-4 relative">
              <input
                type="text"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search documents..."
                className="w-full rounded-lg border border-white/10 bg-white/5 py-2 pl-9 pr-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                aria-label="Search documents"
              />
              <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
            </div>

            <div
              ref={calendarPopupRef}
              className={`lg:hidden overflow-hidden transition-all duration-200 ease-out ${isCalendarOpen ? 'max-h-[36rem] opacity-100 mb-4' : 'max-h-0 opacity-0 mb-0'}`}
            >
              <div className="rounded-lg border border-white/10 bg-white/[0.03] backdrop-blur-sm p-4">
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
              </div>
            </div>

            {(viewMode === 'timeline' ? (isInitialLoading || isSearchLoading) : isCalendarLoading) ? (
              <div className="text-center py-10 text-gray-400">Loading timeline...</div>
            ) : viewMode === 'timeline' && timelineError ? (
              <div className="text-center py-10">
                <p className="text-red-300 mb-4">{timelineError}</p>
                <button
                  onClick={() => {
                    void loadTimelineFirstPage();
                  }}
                  className="inline-flex items-center rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-gray-200 hover:bg-white/10 transition-colors"
                >
                  Retry
                </button>
              </div>
            ) : groups.length === 0 ? (
              <div className="text-center py-10">
                {searchQuery.trim() ? (
                  <p className="text-gray-500">No timeline documents match your search.</p>
                ) : (
                  <>
                    <p className="text-gray-500 mb-4">No documents to show in timeline.</p>
                    <button
                      onClick={handleCreateFirstDocument}
                      className="inline-flex items-center rounded-lg border border-blue-500/30 bg-blue-500/20 px-4 py-2 text-sm font-medium text-blue-100 hover:bg-blue-500/30 transition-colors"
                    >
                      Create your first document
                    </button>
                  </>
                )}
              </div>
            ) : (
              <div className="space-y-6">
                {groups.map((group) => (
                  <section key={group.label}>
                    <h2 className="text-sm font-semibold text-gray-300 mb-3 uppercase tracking-wide">{group.label}</h2>
                    <div className="space-y-2">
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
                          variant={usePreviewCardVariant ? 'preview' : 'legacy'}
                        />
                      ))}
                    </div>
                  </section>
                ))}

                {viewMode === 'timeline' && (
                  <>
                    <div ref={loadMoreRef} className="h-2" />

                    {isLoadingMore && (
                      <div className="text-center py-4 text-xs text-gray-500">Loading more documents...</div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>

          <aside className="hidden lg:block w-[22rem] pl-6 pb-2 ml-auto">
            <div className="sticky top-0 space-y-4">
              <div className="relative mt-2">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search documents..."
                  className="w-full rounded-lg border border-white/10 bg-white/5 py-2 pl-9 pr-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                  aria-label="Search documents"
                />
                <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
              </div>

              <div className="rounded-lg border border-white/10 bg-white/[0.03] backdrop-blur-sm p-4">
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
              </div>
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
        isOpen={!!deleteConfirmState}
        title="Move to Trash"
        message={deleteConfirmState ? `Move "${deleteConfirmState.title}" to trash?` : 'Move this document to trash?'}
        onSave={() => undefined}
        onDiscard={() => {
          void handleConfirmDelete();
        }}
        onCancel={() => setDeleteConfirmState(null)}
        saveLabel=""
        discardLabel="Delete"
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
