import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { EditorHeader } from './editor/EditorHeader';
import { EditorTags } from './editor/EditorTags';
import { EditorContent } from './editor/EditorContent';
import { Footer } from './Footer';
import { useDocumentEditorState } from './editor/useDocumentEditorState';
import { DocumentLoadingState, DocumentNotFoundState } from './editor/DocumentEditorStatus';
import { EditorDragOverlay, EditorReadOnlyOverlay, ShowHeaderButton } from './editor/DocumentEditorOverlays';
import { PublicShareModal } from './modals/PublicShareModal';
import { usePublicShareModalState } from './modals/usePublicShareModalState';
import { ConfirmDialog } from './modals/ConfirmDialog';
import { deleteDocument } from '../lib/documents/trash';
import { exportDocument } from '../lib/export';
import { useToasts } from '../state/hooks';

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
    tags,
    tagInput,
    setTagInput,
    published,
    setPublished,
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
    isLoadingDocument,
    loading,
  } = useDocumentEditorState();

  const navigate = useNavigate();
  const { showToast } = useToasts();
  const publicShareModal = usePublicShareModalState();
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  const handleShare = () => {
    if (document?.id) {
      void publicShareModal.openDocument(document.id);
    }
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
      showToast('Document moved to trash', 'success');
      setDeleteConfirm(false);
      navigate('/');
    } catch {
      showToast('Failed to delete document', 'error');
    }
  };

  if (isLoadingDocument || loading) {
    return <DocumentLoadingState />;
  }

  if (documentNotFound) {
    return <DocumentNotFoundState />;
  }

  return (
    <div
      className="flex flex-col h-full bg-black/40 backdrop-blur-md relative"
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
          <EditorHeader
            title={title}
            onTitleChange={setTitle}
            readOnly={isTrashDocument}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            published={published}
            onPublishedChange={setPublished}
            onCancel={handleCancel}
            onPublish={handlePublish}
            publishing={publishing}
            hasUnsavedChanges={hasUnsavedChanges}
            isNewDocument={urlDocumentId === 'new'}
            autoSaving={isAutoSaving}
            headerVisible={!isDesktop ? headerVisible : true}
            onToggleHeader={!isDesktop ? () => setHeaderVisible(!headerVisible) : undefined}
            titleInputRef={titleInputRef}
            onShare={handleShare}
            onExport={handleExport}
            onDelete={handleDelete}
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
            readOnly={isTrashDocument}
            onTagInputChange={setTagInput}
            onAddTag={handleAddTag}
            onRemoveTag={handleRemoveTag}
          />
        </div>

        <EditorReadOnlyOverlay visible={isTrashDocument} />

        <div className="md:flex-1 flex-1 min-h-0 md:pb-12 overflow-hidden">
          <EditorContent
            content={content}
            onContentChange={setContent}
            readOnly={isTrashDocument}
            viewMode={viewMode}
            editablePreview={viewMode === 'preview'}
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
            readOnly={isTrashDocument}
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
            readOnly={isTrashDocument}
            usePortal
          />
        </div>
      )}

      <PublicShareModal
        target={publicShareModal.target}
        isOpen={publicShareModal.isOpen}
        isSaving={publicShareModal.isSaving}
        onClose={publicShareModal.close}
        onSave={publicShareModal.save}
      />

      <ConfirmDialog
        isOpen={deleteConfirm}
        title="Delete Document"
        message="Are you sure you want to delete this document? It will be moved to trash."
        saveLabel="Delete"
        onSave={confirmDelete}
        onDiscard={() => setDeleteConfirm(false)}
        onCancel={() => setDeleteConfirm(false)}
      />
    </div>
  );
}

export default DocumentEditor;
