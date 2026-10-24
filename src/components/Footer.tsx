import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { getDocumentVersions, restoreDocumentVersion, getAttachmentUrls, getAttachmentUrlWithFreshToken, isPdfFile, isTextFile, isViewableFile, type DocumentVersion, type Document } from '../lib/documents';
import { useToasts } from '../state/hooks';
import { createLogger } from '../lib/logger';

const log = createLogger('Footer');
import { VersionPreviewModal } from './modals/VersionPreviewModal';
import { LazyAttachmentViewer } from './modals/LazyAttachmentViewer';
import {
  DocumentTextIcon,
  ClockIcon,
  HashtagIcon,
  PaperClipIcon,
  ArrowDownTrayIcon,
  TrashIcon,
  ArrowUturnLeftIcon,
  PlusIcon,
  DocumentIcon,
  CheckIcon,
  XMarkIcon,
  BookmarkIcon,
  EyeIcon,
  EllipsisVerticalIcon
} from '@heroicons/react/24/outline';

interface FooterProps {
  sidebarOpen: boolean;
  sidebarWidth?: number;
  isDesktop?: boolean;
  document?: Document;
  documentId?: string;
  words?: number;
  readingTime?: number;
  characters?: number;
  lastUpdated?: string;
  newAttachments: File[];
  removedAttachments: string[];
  onDocumentRestored?: () => void;
  onCreateNewFromVersion?: (content: string) => void;
  onAttachmentsChange: (files: File[]) => void;
  onAttachmentRemove: (filename: string, isExisting: boolean) => void;
  onImmediateAttachmentDelete?: (filename: string) => Promise<void>;
  onAutoSaveAttachments?: (files: File[]) => void;
  onPublish?: () => void;
  publishing?: boolean;
  usePortal?: boolean;
  readOnly?: boolean;
}

export function Footer({ sidebarOpen, sidebarWidth = 0, isDesktop = true, document, documentId, words = 0, readingTime = 0, characters = 0, lastUpdated, newAttachments, removedAttachments, onDocumentRestored, onCreateNewFromVersion, onAttachmentsChange, onAttachmentRemove, onImmediateAttachmentDelete, onAutoSaveAttachments, onPublish, publishing = false, usePortal = false, readOnly = false }: FooterProps) {
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const [showAttachments, setShowAttachments] = useState(false);
  const [versions, setVersions] = useState<DocumentVersion[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedVersion, setSelectedVersion] = useState<DocumentVersion | null>(null);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const versionMenuRef = useRef<HTMLDivElement>(null);
  const attachmentsMenuRef = useRef<HTMLDivElement>(null);
  const attachmentsButtonRef = useRef<HTMLButtonElement>(null);
  const versionButtonRef = useRef<HTMLButtonElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingDeleteFilename, setPendingDeleteFilename] = useState<string | null>(null);
  const [viewerAttachment, setViewerAttachment] = useState<{ url: string; filename: string } | null>(null);
  const [openAttachmentMenu, setOpenAttachmentMenu] = useState<string | null>(null);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [attachmentsPosition, setAttachmentsPosition] = useState<{ top?: number; bottom?: number; left?: number; right?: number }>({});
  const [versionPosition, setVersionPosition] = useState<{ top?: number; bottom?: number; left?: number; right?: number }>({});
  const { showToast } = useToasts();

  const COMPACT_SIDEBAR_WIDTH = 80;

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (showVersionHistory && versionMenuRef.current && !versionMenuRef.current.contains(e.target as Node) && !versionButtonRef.current?.contains(e.target as Node)) {
        setShowVersionHistory(false);
      }
      if (showAttachments && attachmentsMenuRef.current && !attachmentsMenuRef.current.contains(e.target as Node) && !attachmentsButtonRef.current?.contains(e.target as Node)) {
        setShowAttachments(false);
      }
    };

    if (showVersionHistory || showAttachments) {
      window.document.addEventListener('mousedown', handleClickOutside);
      return () => window.document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showVersionHistory, showAttachments]);

  // Close attachment action menu when clicking outside
  useEffect(() => {
    if (!openAttachmentMenu) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenAttachmentMenu(null);
      }
    };
    window.document.addEventListener('mousedown', handleClick);
    return () => window.document.removeEventListener('mousedown', handleClick);
  }, [openAttachmentMenu]);

  // Load version history
  const handleShowVersionHistory = async () => {
    if (!documentId) return;

    if (showVersionHistory) {
      setShowVersionHistory(false);
      return;
    }

    setShowVersionHistory(true);
    setLoading(true);

    try {
      const result = await getDocumentVersions(documentId);
      setVersions(result.items);
    } catch (error) {
      log.error('Failed to load version history', error);
    } finally {
      setLoading(false);
    }
  };

  const handleVersionClick = (version: DocumentVersion) => {
    setSelectedVersion(version);
    setShowPreviewModal(true);
    setShowVersionHistory(false);
  };

  const handleRevertVersion = async (versionId: string) => {
    if (!documentId) return;

    try {
      await restoreDocumentVersion(documentId, versionId);
      setShowPreviewModal(false);
      if (onDocumentRestored) {
        onDocumentRestored();
      }
    } catch (error) {
      log.error('Failed to restore version', error);
      showToast('Failed to restore version. Please try again.', 'error');
    }
  };

  const handleCreateNewFromVersion = (content: string) => {
    if (onCreateNewFromVersion) {
      onCreateNewFromVersion(content);
    }
    setShowPreviewModal(false);
  };

  const handleFileSelect = (files: FileList | null) => {
    if (!files || files.length === 0) return;

    const fileArray = Array.from(files);

    // Auto-save attachments immediately if we have an existing document
    if (document?.id && onAutoSaveAttachments) {
      onAutoSaveAttachments(fileArray);
    } else {
      // For new documents, just add to pending attachments
      onAttachmentsChange([...newAttachments, ...fileArray]);
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return 'Just now';
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  const leftOffset = isDesktop ? (sidebarOpen ? sidebarWidth : COMPACT_SIDEBAR_WIDTH) : 0;

  const footerClasses = [
    'md:fixed md:bottom-0 relative z-20 md:z-40 border-t md:transition-[left] md:duration-300 md:ease-in-out motion-reduce:transition-none',
    'bg-canvas-deep border-line'
  ].join(' ');

  const surfaceTextClass = 'text-ink-muted';

  const badgeClass = 'bg-signal text-on-signal';
  const addButtonClass = 'text-[11px] font-medium px-2 py-1 bg-signal-soft text-signal rounded-[6px] hover:bg-signal/20 transition-colors';

  const attachmentPanelClass = [
    'fixed md:absolute left-4 right-4 md:left-auto top-full mt-2 md:top-auto md:bottom-full md:mt-0 md:mb-2 md:right-0',
    'border rounded-panel overflow-hidden shadow-float md:min-w-[360px] max-w-[calc(100vw-2rem)] md:max-w-none max-h-[70vh] md:max-h-[520px] overflow-y-auto scrollbar-autohide z-[9999]',
    'bg-surface-raised border-line'
  ].join(' ');

  const footer = (
    <footer
      className={footerClasses}
      style={{
        left: isDesktop ? `${leftOffset}px` : undefined,
        right: isDesktop ? 0 : undefined,
      }}
    >
      <div className={`px-4 py-3 flex flex-wrap items-center justify-evenly md:justify-start gap-3 md:gap-6 text-xs ${surfaceTextClass}`}>
        <div className="flex items-center gap-1.5">
          <DocumentTextIcon className="w-4 h-4" />
          <span>{words} words</span>
        </div>
        <div className="flex items-center gap-1.5">
          <ClockIcon className="w-4 h-4" />
          <span>{readingTime} min read</span>
        </div>
        <div className="flex items-center gap-1.5">
          <HashtagIcon className="w-4 h-4" />
          <span>{characters} characters</span>
        </div>
        {documentId && (
          <div className="relative md:ml-auto z-[9999]">
            <button
              ref={attachmentsButtonRef}
              onClick={async (e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const viewportHeight = window.innerHeight;
                const spaceBelow = viewportHeight - rect.bottom;
                const spaceAbove = rect.top;

                if (isDesktop) {
                  // Desktop: position above the button
                  setAttachmentsPosition({
                    bottom: viewportHeight - rect.top + 8,
                    right: window.innerWidth - rect.right,
                  });
                } else {
                  // Mobile: center horizontally with padding
                  setAttachmentsPosition({
                    top: spaceBelow > 400 ? rect.bottom + 8 : undefined,
                    bottom: spaceBelow <= 400 ? viewportHeight - rect.top + 8 : undefined,
                    left: 16,
                    right: 16,
                  });
                }
                setShowAttachments(!showAttachments);
              }}
              className={`inline-flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-control border px-3 text-[11px] transition-colors ${showAttachments ? 'border-signal/35 bg-signal-soft text-signal' : 'border-line bg-surface text-ink-secondary hover:border-line-strong hover:text-ink'}`}
            >
              <PaperClipIcon className="w-3.5 h-3.5" />
              <span>Attachments</span>
              {((document?.attachments?.length || 0) + newAttachments.length - removedAttachments.length > 0) && (
                <span className={`${badgeClass} text-[10px] min-w-4 h-4 px-1 rounded-full inline-flex items-center justify-center leading-none`}>
                  {(document?.attachments?.length || 0) + newAttachments.length - removedAttachments.length}
                </span>
              )}
            </button>

            {/* Attachments Popup */}
            {showAttachments && createPortal(
              <div
                ref={attachmentsMenuRef}
                className="fixed overflow-hidden rounded-panel border border-line bg-surface-raised shadow-float w-[calc(100vw-2rem)] md:w-auto md:min-w-[380px] md:max-w-none max-h-[70vh] md:max-h-[520px] overflow-y-auto scrollbar-autohide z-[10001]"
                style={attachmentsPosition}
              >
                <div className="flex items-center justify-between border-b border-line px-4 py-3">
                  <h3 className="font-display text-base text-ink">Attachments</h3>
                  {!readOnly && (
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className={addButtonClass}
                    >
                      + Add
                    </button>
                  )}
                </div>

                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => handleFileSelect(e.target.files)}
                />

                {(() => {
                  const existingAttachments = document
                    ? getAttachmentUrls(document)
                    : [];
                  const hasAttachments = existingAttachments.length > 0 || newAttachments.length > 0;

                  return hasAttachments ? (
                    <div className="py-2">
                      {/* Existing attachments */}
                      {existingAttachments.map((att) => {
                        const isMarkedForRemoval = removedAttachments.includes(att.filename);
                        const viewable = isViewableFile(att.filename);

                        const handleRowClick = () => {
                          if (isMarkedForRemoval) return;
                          if (viewable) {
                            setViewerAttachment({ url: att.url, filename: att.displayName });
                            setShowAttachments(false);
                          } else {
                            // Download non-viewable files
                            fetch(att.url)
                              .then(res => res.blob())
                              .then(blob => {
                                const url = window.URL.createObjectURL(blob);
                                const a = window.document.createElement('a');
                                a.href = url;
                                a.download = att.displayName;
                                window.document.body.appendChild(a);
                                a.click();
                                window.document.body.removeChild(a);
                                window.URL.revokeObjectURL(url);
                              })
                              .catch(error => log.error('Failed to download file', error));
                          }
                        };

                        const handleDownload = (e: React.MouseEvent) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setOpenAttachmentMenu(null);
                          fetch(att.url)
                            .then(res => res.blob())
                            .then(blob => {
                              const url = window.URL.createObjectURL(blob);
                              const a = window.document.createElement('a');
                              a.href = url;
                              a.download = att.displayName;
                              window.document.body.appendChild(a);
                              a.click();
                              window.document.body.removeChild(a);
                              window.URL.revokeObjectURL(url);
                            })
                            .catch(error => log.error('Failed to download file', error));
                        };

                        return (
                          <div
                            key={att.filename}
                            className={`px-3 py-2 hover:bg-surface-raised transition-colors border-b border-line last:border-b-0 ${
                              isMarkedForRemoval ? 'bg-danger-soft border-danger/30' : 'cursor-pointer'
                            }`}
                            onClick={handleRowClick}
                          >
                            <div className="flex items-center gap-2">
                              <div className={`w-8 h-8 flex-shrink-0 rounded overflow-hidden ${
                                isMarkedForRemoval ? 'opacity-50 grayscale' : 'bg-surface-raised'
                              }`}>
                                {att.filename.match(/\.(jpg|jpeg|png|gif|webp)$/i) ? (
                                  <img
                                    src={att.thumbUrl}
                                    alt={att.displayName}
                                    className="w-full h-full object-cover"
                                    onError={async (event) => {
                                      const image = event.currentTarget;
                                      if (image.dataset.tokenRetry === '1') {
                                        return;
                                      }

                                      image.dataset.tokenRetry = '1';

                                      try {
                                        image.src = await getAttachmentUrlWithFreshToken(att.thumbUrl);
                                      } catch (error) {
                                        log.error('Failed to refresh attachment thumbnail token', error);
                                      }
                                    }}
                                  />
                                ) : isPdfFile(att.filename) ? (
                                  <div className="w-full h-full flex items-center justify-center">
                                    <DocumentTextIcon className="w-4 h-4 text-danger" />
                                  </div>
                                ) : isTextFile(att.filename) ? (
                                  <div className="w-full h-full flex items-center justify-center">
                                    <DocumentTextIcon className="w-4 h-4 text-signal" />
                                  </div>
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center">
                                    <DocumentIcon className="w-4 h-4 text-ink-secondary" />
                                  </div>
                                )}
                              </div>

                            <div className="flex-1 min-w-0">
                              <p className={`text-xs truncate ${
                                isMarkedForRemoval ? 'text-danger line-through' : 'text-ink'
                              }`}>{att.displayName}</p>
                              {isMarkedForRemoval && (
                                <p className="text-xs text-danger/60">Will be removed on save</p>
                              )}
                            </div>

                            <div className="flex items-center gap-1">
                              {!isMarkedForRemoval && viewable && (
                                <button
                                  onMouseDown={(e) => e.stopPropagation()}
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    if (openAttachmentMenu === att.filename) {
                                      setOpenAttachmentMenu(null);
                                      setMenuPosition(null);
                                    } else {
                                      const rect = e.currentTarget.getBoundingClientRect();
                                      setMenuPosition({ top: rect.top, left: rect.right });
                                      setOpenAttachmentMenu(att.filename);
                                    }
                                  }}
                                  className="p-1 text-ink-secondary hover:text-ink hover:bg-surface-raised rounded transition-colors"
                                  title="More actions"
                                >
                                  <EllipsisVerticalIcon className="w-4 h-4" />
                                </button>
                              )}
                              {!isMarkedForRemoval && viewable && openAttachmentMenu === att.filename && menuPosition && createPortal(
                                <div
                                  ref={menuRef}
                                  className="fixed z-[10003] bg-surface-raised border border-line rounded-control shadow-float py-1 min-w-[120px]"
                                  style={{ top: menuPosition.top, left: menuPosition.left, transform: 'translate(-100%, -100%)' }}
                                >
                                  <button
                                    onClick={(e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      setOpenAttachmentMenu(null);
                                      setViewerAttachment({ url: att.url, filename: att.displayName });
                                      setShowAttachments(false);
                                    }}
                                    className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-ink hover:bg-surface-raised transition-colors"
                                  >
                                    <EyeIcon className="w-3.5 h-3.5" />
                                    Open
                                  </button>
                                  <button
                                    onClick={handleDownload}
                                    className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-ink hover:bg-surface-raised transition-colors"
                                  >
                                    <ArrowDownTrayIcon className="w-3.5 h-3.5" />
                                    Download
                                  </button>
                                </div>,
                                window.document.body
                              )}
                              {!isMarkedForRemoval && !viewable && (
                                <button
                                  onClick={handleDownload}
                                  className="p-1 text-signal hover:text-signal hover:bg-signal-soft rounded transition-colors"
                                  title="Download"
                                >
                                  <ArrowDownTrayIcon className="w-4 h-4" />
                                </button>
                              )}
                              {!readOnly && (pendingDeleteFilename === att.filename ? (
                                <div className="flex items-center gap-1">
                                  <button
                                    onClick={async (e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      if (onImmediateAttachmentDelete) {
                                        await onImmediateAttachmentDelete(att.filename);
                                      }
                                      setPendingDeleteFilename(null);
                                    }}
                                    className="p-1 text-success hover:text-success hover:bg-success-soft rounded transition-colors"
                                    title="Confirm delete"
                                  >
                                    <CheckIcon className="w-4 h-4" />
                                  </button>
                                  <button
                                    onClick={(e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      setPendingDeleteFilename(null);
                                    }}
                                    className="p-1 text-ink-secondary hover:text-ink-secondary hover:bg-surface-raised/20 rounded transition-colors"
                                    title="Cancel"
                                  >
                                    <XMarkIcon className="w-4 h-4" />
                                  </button>
                                </div>
                              ) : (
                                <button
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    if (isMarkedForRemoval) {
                                      onAttachmentRemove(att.filename, true);
                                    } else {
                                      setPendingDeleteFilename(att.filename);
                                    }
                                  }}
                                  className={`p-1 rounded transition-colors ${
                                    isMarkedForRemoval
                                      ? 'text-success hover:text-success hover:bg-success-soft'
                                      : 'text-danger hover:text-danger hover:bg-danger-soft'
                                  }`}
                                  title={isMarkedForRemoval ? "Undo removal" : "Remove"}
                                >
                                  {isMarkedForRemoval ? (
                                    <ArrowUturnLeftIcon className="w-4 h-4" />
                                  ) : (
                                    <TrashIcon className="w-4 h-4" />
                                  )}
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>
                        );
                      })}

                      {/* New attachments */}
                      {newAttachments.map((file) => (
                        <div
                          key={file.name}
                          className="px-3 py-2 bg-signal-soft/50 hover:bg-signal-soft transition-colors border-b border-line last:border-b-0"
                        >
                          <div className="flex items-center gap-2">
                            <div className="w-8 h-8 flex-shrink-0 rounded bg-surface-raised flex items-center justify-center">
                              <PlusIcon className="w-4 h-4 text-signal" />
                            </div>

                            <div className="flex-1 min-w-0">
                              <p className="text-xs text-signal truncate">{file.name}</p>
                              <p className="text-xs text-signal/60">{formatFileSize(file.size)}</p>
                            </div>

                            {!readOnly && (
                              <button
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  onAttachmentRemove(file.name, false);
                                }}
                                className="p-1 text-danger hover:text-danger hover:bg-danger-soft rounded transition-colors"
                                title="Remove"
                              >
                                <TrashIcon className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="p-6 text-center text-ink-secondary text-xs">
                      <p>No attachments</p>
                    </div>
                  );
                })()}
              </div>,
              window.document.body
            )}
          </div>
        )}
        {lastUpdated && documentId && (
          <div className="relative z-[9999]">
            <button
              ref={versionButtonRef}
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const viewportHeight = window.innerHeight;
                const spaceBelow = viewportHeight - rect.bottom;
                const spaceAbove = rect.top;

                if (isDesktop) {
                  // Desktop: position above the button
                  setVersionPosition({
                    bottom: viewportHeight - rect.top + 8,
                    right: window.innerWidth - rect.right,
                  });
                } else {
                  // Mobile: center horizontally with padding
                  setVersionPosition({
                    top: spaceBelow > 400 ? rect.bottom + 8 : undefined,
                    bottom: spaceBelow <= 400 ? viewportHeight - rect.top + 8 : undefined,
                    left: 16,
                    right: 16,
                  });
                }
                handleShowVersionHistory();
              }}
              className={`inline-flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-control border px-3 text-[11px] transition-colors ${showVersionHistory ? 'border-signal/35 bg-signal-soft text-signal' : 'border-line bg-surface text-ink-secondary hover:border-line-strong hover:text-ink'}`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>Updated {formatDate(lastUpdated)}</span>
            </button>

            {/* Version History Popup */}
            {showVersionHistory && createPortal(
              <div
                ref={versionMenuRef}
                className="fixed overflow-hidden rounded-panel border border-line bg-surface-raised shadow-float w-[calc(100vw-2rem)] md:w-[280px] max-h-[420px] overflow-y-auto scrollbar-autohide z-[10001]"
                style={versionPosition}
              >
                <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
                  <h3 className="font-display text-base text-ink">Version history</h3>
                  {onPublish && (
                    <button
                      onClick={() => {
                        onPublish();
                        setShowVersionHistory(false);
                      }}
                      disabled={publishing}
                      className="rounded p-1.5 bg-surface-raised text-ink transition-colors hover:bg-surface disabled:cursor-not-allowed disabled:opacity-50"
                      title={publishing ? 'Publishing...' : 'Publish Version'}
                    >
                      <BookmarkIcon className="w-4 h-4" />
                    </button>
                  )}
                </div>

                {loading ? (
                  <div className="p-4 text-center text-ink-secondary text-sm">Loading...</div>
                ) : versions.length === 0 ? (
                  <div className="p-4 text-center text-ink-secondary text-sm">No version history</div>
                ) : (
                  <div className="py-2">
                    {versions.map((version) => (
                      <button
                        key={version.id}
                        onClick={() => handleVersionClick(version)}
                        className="w-full px-4 py-3 hover:bg-surface-raised transition-colors border-b border-line last:border-b-0 text-left"
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-medium text-ink">
                            Version {version.version_number}
                          </span>
                          <span className="text-xs text-ink-muted">
                            {formatDate(version.source_created_at || version.created)}
                          </span>
                        </div>
                        <p className="text-xs text-ink-secondary">{version.change_summary}</p>
                      </button>
                    ))}
                  </div>
                )}
              </div>,
              window.document.body
            )}
          </div>
        )}
      </div>

      {/* Version Preview Modal */}
      <VersionPreviewModal
        isOpen={showPreviewModal}
        version={selectedVersion}
        onClose={() => setShowPreviewModal(false)}
        onRevert={handleRevertVersion}
        onCreateNew={handleCreateNewFromVersion}
      />

      {/* Attachment Viewer Modal */}
      <LazyAttachmentViewer
        isOpen={!!viewerAttachment}
        url={viewerAttachment?.url ?? ''}
        filename={viewerAttachment?.filename ?? ''}
        onClose={() => setViewerAttachment(null)}
      />
    </footer>
  );

  if (usePortal && typeof window !== 'undefined' && window.document?.body) {
    return createPortal(footer, window.document.body);
  }

  return footer;
}
