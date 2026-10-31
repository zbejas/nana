import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAtom, useSetAtom } from 'jotai';
import { EditorHeader } from './editor/EditorHeader';
import { EditorTags } from './editor/EditorTags';
import { EditorContent, type EditorAiEdit } from './editor/EditorContent';
import { normalizeMarkdown } from './editor/milkdown/helpers';
import { ContentSizeWarning } from './editor/ContentSizeWarning';
import { Footer } from './Footer';
import { useDocumentEditorState } from './editor/useDocumentEditorState';
import { DocumentLoadingState, DocumentNotFoundState } from './editor/DocumentEditorStatus';
import { EditorDragOverlay, EditorReadOnlyOverlay, ShowHeaderButton } from './editor/DocumentEditorOverlays';
import { SharePanel, useSharePanel } from './sharing';
import { AiEditingBanner } from './chat/AiEditingBanner';
import { ConfirmDialog } from './ui';
import { deleteDocument } from '../lib/documents/trash';
import { getDocument } from '../lib/documents';
import type { ChatUiEdit } from '../lib/chat/types';
import { subscribeWorkspaceChanged } from '../lib/workspace-events';
import { exportDocument } from '../lib/export';
import { useToasts } from '../state/hooks';
import { chatDockOpenAtom, editorFullscreenAtom, refreshTriggerAtom } from '../state/atoms';

export function DocumentEditor() {
  const {
    urlDocumentId,
    document,
    sidebarOpen,
    sidebarWidth,
    titleInputRef,
    title,
    setTitle,
    content,
    setContent,
    setSelectedDocument,
    remoteContentChangeRef,
    tags,
    setTags,
    setGlobalUnsavedChanges,
    tagInput,
    setTagInput,
    publishing,
    documentNotFound,
    hasUnsavedChanges,
    isDesktop,
    MOBILE_EDITOR_HEIGHT,
    viewMode,
    setViewMode,
    headerVisible,
    setHeaderVisible,
    headerExpanded,
    isDraggingFile,
    isMouseOverEditor,
    isAutoSaving,
    newAttachments,
    removedAttachments,
    handleAttachmentsChange,
    handleAttachmentRemove,
    handleImmediateAttachmentDelete,
    handleAutoSaveAttachments,
    handleDragEnter,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleCancel,
    handlePublish,
    handleAddTag,
    handleRemoveTag,
    contentStats,
    handleDocumentRestored,
    handleCreateNewFromVersion,
    isTrashDocument,
    isReadOnly,
    isLoadingDocument,
    loading,
    collaborators,
    handleEditorSelection,
  } = useDocumentEditorState();

  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const setRefreshTrigger = useSetAtom(refreshTriggerAtom);
  const setChatDockOpen = useSetAtom(chatDockOpenAtom);
  const [fullscreen, setFullscreen] = useAtom(editorFullscreenAtom);
  const { showToast } = useToasts();
  const sharePanel = useSharePanel();
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [aiEdit, setAiEdit] = useState<EditorAiEdit | null>(null);
  const contentRef = useRef(content);
  const lastAiEditIdRef = useRef<string | null>(null);
  contentRef.current = content;

  useEffect(() => {
    setAiEdit(null);
    lastAiEditIdRef.current = null;
  }, [document?.id]);

  useEffect(() => {
    if (!aiEdit) return;
    const timer = window.setTimeout(() => setAiEdit(null), 1200);
    return () => window.clearTimeout(timer);
  }, [aiEdit]);

  useEffect(() => {
    const currentId = document?.id;
    if (!currentId) return;

    const handleAiEdit = (event: Event) => {
      const edit = (event as CustomEvent<{ edit?: ChatUiEdit }>).detail?.edit;
      if (!edit || edit.target.type !== 'document' || edit.target.id !== currentId) return;
      if (lastAiEditIdRef.current === edit.id) return;
      lastAiEditIdRef.current = edit.id;

      const targetId = edit.target.id;
      const currentMarkdown = contentRef.current;
      const remoteChange = remoteContentChangeRef.current;
      const previousMarkdown = remoteChange
        && normalizeMarkdown(currentMarkdown) === remoteChange.to
        ? remoteChange.from
        : currentMarkdown;
      remoteContentChangeRef.current = null;
      void getDocument(targetId)
        .then((fresh) => {
          if (document?.id !== targetId) return;
          // The editor serializes normalized Markdown. Normalize the fetched
          // copy before putting it into state so the header and the editor do
          // not alternate between the raw and serialized byte counts.
          const nextContent = normalizeMarkdown(fresh.content);
          setSelectedDocument({ ...fresh, content: nextContent });
          setTitle(fresh.title);
          setContent(nextContent);
          setTags(fresh.tags || []);
          setGlobalUnsavedChanges(false);
          setAiEdit({
            id: edit.id,
            previousMarkdown,
            markdown: nextContent,
            sections: (edit.changed.sections ?? []).map((section) => ({
              ...(section.heading ? { heading: section.heading } : {}),
              ...(section.path ? { path: section.path } : {}),
              ...(section.from !== undefined ? { from: section.from } : {}),
              ...(section.to !== undefined ? { to: section.to } : {}),
            })),
          });
        })
        .catch((error: unknown) => {
          showToast(
            error instanceof Error
              ? `Nana changed this note, but the editor could not refresh: ${error.message}`
              : 'Nana changed this note, but the editor could not refresh.',
            'error',
          );
        });
    };

    window.addEventListener('nana:ai-edit', handleAiEdit);
    return () => window.removeEventListener('nana:ai-edit', handleAiEdit);
  }, [
    document?.id,
    setContent,
    setGlobalUnsavedChanges,
    setSelectedDocument,
    setTags,
    setTitle,
    showToast,
  ]);

  // Chat folder deletion can trash this note without naming it in the event.
  // Re-read the open note so an editor inside the deleted subtree closes.
  useEffect(() => {
    const currentId = document?.id;
    if (!currentId) return;

    return subscribeWorkspaceChanged((detail) => {
      if (!detail.removed) return;
      const folderRemoved = detail.targets.some((target) => target.type === 'folder');
      const documentRemoved = detail.targets.some(
        (target) => target.type === 'document' && target.id === currentId,
      );
      if (!folderRemoved || documentRemoved) return;

      void getDocument(currentId)
        .then(() => undefined)
        .catch((error: { status?: number }) => {
          if (error?.status !== 404) return;
          setGlobalUnsavedChanges(false);
          navigate('/folders');
        });
    });
  }, [document?.id, navigate, setGlobalUnsavedChanges]);

  // Chat edit cards link here with ?nanaSection=Heading (or Parent > Child).
  // Scroll to that heading once the editor surface exists; never touch the
  // Milkdown document itself.
  useEffect(() => {
    const section = searchParams.get('nanaSection');
    if (!section || loading || isLoadingDocument) return;

    let cancelled = false;
    let timer: number | undefined;
    let finishTimer: number | undefined;
    const wanted = (section.split('>').pop() ?? section).trim().toLowerCase();
    const deadline = Date.now() + 2400;

    const clearParam = () => {
      const next = new URLSearchParams(searchParams);
      next.delete('nanaSection');
      setSearchParams(next, { replace: true });
    };

    const findHeading = (): HTMLElement | null => {
      const root = window.document.querySelector('.nana-milkdown .ProseMirror')
        ?? window.document.querySelector('.nana-milkdown');
      if (!root) return null;
      const headings = Array.from(root.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6'));
      return headings.find((heading) => heading.textContent?.trim().toLowerCase() === wanted)
        ?? headings.find((heading) => heading.textContent?.trim().toLowerCase().includes(wanted))
        ?? null;
    };

    const focusSection = () => {
      if (cancelled) return;
      const match = findHeading();
      if (match) {
        // Query the live node each attempt; Milkdown replaces heading nodes
        // while the editor finishes its initial mount.
        match.scrollIntoView({ behavior: 'smooth', block: 'center' });
        finishTimer = window.setTimeout(clearParam, 900);
        return;
      }
      if (Date.now() < deadline) {
        timer = window.setTimeout(focusSection, 180);
      } else {
        finishTimer = window.setTimeout(clearParam, 0);
      }
    };

    focusSection();

    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
      if (finishTimer) window.clearTimeout(finishTimer);
    };
  }, [searchParams, setSearchParams, loading, isLoadingDocument, document?.id, viewMode]);

  const handleShare = () => {
    if (!document?.id) return;
    sharePanel.openSharePanel({
      targetType: 'document',
      targetId: document.id,
      targetTitle: title.trim() || document.title || 'Untitled',
      ...(document.folder ? { folderId: document.folder } : {}),
      onChanged: () => setRefreshTrigger((value) => value + 1),
    });
  };

  const handleExport = async () => {
    if (!document?.id) return;
    try {
      await exportDocument(document.id);
      showToast('Document exported successfully', 'success');
    } catch {
      showToast('Failed to export document', 'error');
    }
  };

  const handleDelete = () => {
    setDeleteConfirm(true);
  };

  const confirmDelete = async () => {
    if (!document?.id) return;
    try {
      await deleteDocument(document.id);
      setRefreshTrigger((previous) => previous + 1);
      showToast('Note moved to trash', 'info');
      setDeleteConfirm(false);
      navigate('/folders');
    } catch {
      showToast('Failed to delete the note', 'error');
    }
  };

  if (isLoadingDocument || loading) {
    return <DocumentLoadingState />;
  }

  if (documentNotFound) {
    return <DocumentNotFoundState />;
  }

  const effectiveViewMode = !isDesktop && viewMode === 'split' ? 'wysiwyg' : viewMode;

  return (
    <div
      className="relative flex h-full flex-col bg-canvas"
      style={{
        height: isDesktop ? undefined : MOBILE_EDITOR_HEIGHT,
        minHeight: isDesktop ? undefined : MOBILE_EDITOR_HEIGHT,
      }}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <EditorDragOverlay visible={isDraggingFile && isMouseOverEditor} />

      <div className="relative md:flex-1 flex-1 min-h-0 flex flex-col">

        <div
          className="md:sticky md:top-0 md:z-10 relative overflow-hidden transition-all duration-300 ease-in-out"
          style={{
            maxHeight: headerExpanded ? '500px' : '0px',
            transform: headerExpanded ? 'translateY(0)' : 'translateY(-12px)',
          }}
        >
          <AiEditingBanner type="document" id={document?.id} />
          <EditorHeader
            title={title}
            onTitleChange={setTitle}
            readOnly={isReadOnly}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            isMobile={!isDesktop}
            onCancel={handleCancel}
            onPublish={handlePublish}
            publishing={publishing}
            hasUnsavedChanges={hasUnsavedChanges}
            isNewDocument={urlDocumentId === 'new'}
            autoSaving={isAutoSaving}
            collaborators={collaborators}
            onToggleHeader={!isDesktop ? () => setHeaderVisible(!headerVisible) : undefined}
            titleInputRef={titleInputRef}
            onShare={handleShare}
            onExport={handleExport}
            onDelete={handleDelete}
            onAskNana={() => setChatDockOpen(true)}
            askNanaDisabled={urlDocumentId === 'new' || Boolean(isReadOnly)}
            fullscreen={fullscreen}
            onToggleFullscreen={() => setFullscreen((value) => !value)}
          />
        </div>

        <ShowHeaderButton visible={!isDesktop && !headerVisible} onClick={() => setHeaderVisible(true)} />

        <div
          className="md:sticky md:top-[60px] md:z-10 overflow-hidden transition-all duration-300 ease-in-out"
          style={{
            maxHeight: headerExpanded ? '200px' : '0px',
            transform: headerExpanded ? 'translateY(0)' : 'translateY(-12px)',
          }}
        >
          <EditorTags
            tags={tags}
            tagInput={tagInput}
            readOnly={isReadOnly}
            onTagInputChange={setTagInput}
            onAddTag={handleAddTag}
            onRemoveTag={handleRemoveTag}
          />
        </div>

        <EditorReadOnlyOverlay
          visible={isReadOnly}
          reason={isTrashDocument ? 'trash' : 'view'}
        />

        {!isTrashDocument && <ContentSizeWarning content={content} />}

        <div
          className="md:flex-1 flex-1 min-h-0 overflow-hidden"
          style={isDesktop ? { paddingBottom: 'calc(var(--nana-footer-height, 3rem) + 0.75rem)' } : undefined}
        >
          <EditorContent
            key={document?.id ?? urlDocumentId ?? 'new'}
            content={content}
            onContentChange={setContent}
            readOnly={isReadOnly}
            viewMode={effectiveViewMode}
            onDropFiles={handleDrop}
            aiEdit={aiEdit}
            collaborators={collaborators}
            onSelectionChange={handleEditorSelection}
            fullscreen={fullscreen}
          />
        </div>
      </div>

      {!isDesktop && (
        <div
          className="md:hidden sticky bottom-0 z-20 overflow-hidden transition-all duration-300 ease-in-out"
          style={{
            bottom: 0,
            maxHeight: headerVisible ? '500px' : '0px',
            transform: headerVisible ? 'translateY(0)' : 'translateY(12px)',
          }}
        >
          <Footer
            sidebarOpen={sidebarOpen}
            sidebarWidth={sidebarWidth}
            isDesktop={false}
            document={document || undefined}
            documentId={document?.id}
            words={contentStats.words}
            readingTime={contentStats.readingTime}
            characters={contentStats.characters}
            lastUpdated={document?.updated}
            newAttachments={newAttachments}
            removedAttachments={removedAttachments}
            onDocumentRestored={handleDocumentRestored}
            onCreateNewFromVersion={handleCreateNewFromVersion}
            onAttachmentsChange={handleAttachmentsChange}
            onAttachmentRemove={handleAttachmentRemove}
            onImmediateAttachmentDelete={handleImmediateAttachmentDelete}
            onAutoSaveAttachments={handleAutoSaveAttachments}
            onPublish={handlePublish}
            publishing={publishing}
            readOnly={isReadOnly}
          />
        </div>
      )}

      {isDesktop && (
        <div className="hidden md:block">
          <Footer
            sidebarOpen={sidebarOpen}
            sidebarWidth={sidebarWidth}
            isDesktop
            document={document || undefined}
            documentId={document?.id}
            words={contentStats.words}
            readingTime={contentStats.readingTime}
            characters={contentStats.characters}
            lastUpdated={document?.updated}
            newAttachments={newAttachments}
            removedAttachments={removedAttachments}
            onDocumentRestored={handleDocumentRestored}
            onCreateNewFromVersion={handleCreateNewFromVersion}
            onAttachmentsChange={handleAttachmentsChange}
            onAttachmentRemove={handleAttachmentRemove}
            onImmediateAttachmentDelete={handleImmediateAttachmentDelete}
            onAutoSaveAttachments={handleAutoSaveAttachments}
            onPublish={handlePublish}
            publishing={publishing}
            readOnly={isReadOnly}
            usePortal
          />
        </div>
      )}

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

      <ConfirmDialog
        open={deleteConfirm}
        title="Move this note to trash?"
        description="The note will be moved to trash, where you can restore it later."
        confirmLabel="Move to trash"
        tone="danger"
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleteConfirm(false)}
      />
    </div>
  );
}

export default DocumentEditor;
