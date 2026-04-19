import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { Document } from '../../lib/documents';
import { MarkdownPreview } from '../MarkdownPreview';
import { getAttachmentUrls, getAttachmentUrlWithFreshToken, isPdfFile, isTextFile, isViewableFile } from '../../lib/documents';
import { PaperClipIcon, ArrowDownTrayIcon, DocumentTextIcon, EyeIcon, EllipsisVerticalIcon } from '@heroicons/react/24/outline';
import { LazyAttachmentViewer } from './LazyAttachmentViewer';
import { createLogger } from '../../lib/logger';

const log = createLogger('TrashPreview');

interface TrashDocumentPreviewProps {
  isOpen: boolean;
  document: Document | null;
  onClose: () => void;
}

export function TrashDocumentPreview({
  isOpen,
  document,
  onClose,
}: TrashDocumentPreviewProps) {
  const [viewerAttachment, setViewerAttachment] = useState<{ url: string; filename: string } | null>(null);
  const [openAttachmentMenu, setOpenAttachmentMenu] = useState<string | null>(null);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

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

  if (!isOpen || !document) return null;

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const modal = createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-md"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-black/70 backdrop-blur-xl border border-white/15 rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="p-6 border-b border-white/10 flex items-center justify-between">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3">
              <svg className="w-5 h-5 text-red-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              <h3 className="text-xl font-semibold text-white truncate">
                {document.title}
              </h3>
            </div>
            <p className="text-sm text-gray-400 mt-2">
              Deleted {formatDate(document.deleted_at || document.updated)}
            </p>
            {document.tags && document.tags.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {document.tags.map(tag => (
                  <span
                    key={tag}
                    className="px-2 py-1 bg-blue-500/20 text-blue-400 text-xs rounded-md border border-blue-500/30"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors p-2 rounded-lg hover:bg-white/5 flex-shrink-0 ml-4"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content Preview */}
        <div className="flex-1 overflow-y-auto p-6 min-h-[300px] scrollbar-autohide">
          <MarkdownPreview content={document.content || ''} />
          
          {/* Attachments Section */}
          {document.attachments && document.attachments.length > 0 && (
            <div className="mt-8 border-t border-white/10 pt-6">
              <div className="flex items-center gap-2 mb-4">
                <PaperClipIcon className="w-5 h-5 text-gray-400" />
                <h4 className="text-sm font-semibold text-gray-300">
                  Attachments ({document.attachments.length})
                </h4>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {getAttachmentUrls(document).map((att) => {
                  const viewable = isViewableFile(att.filename);

                  const handleRowClick = () => {
                    if (viewable) {
                      setViewerAttachment({ url: att.url, filename: att.displayName });
                    } else {
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
                    className="flex items-center gap-3 p-3 bg-white/5 hover:bg-white/10 rounded-lg border border-white/10 transition-colors cursor-pointer"
                    onClick={handleRowClick}
                  >
                    <div className="w-10 h-10 flex-shrink-0 rounded overflow-hidden bg-gray-700">
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
                          <DocumentTextIcon className="w-5 h-5 text-red-400" />
                        </div>
                      ) : isTextFile(att.filename) ? (
                        <div className="w-full h-full flex items-center justify-center">
                          <DocumentTextIcon className="w-5 h-5 text-blue-400" />
                        </div>
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <PaperClipIcon className="w-5 h-5 text-gray-400" />
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-200 truncate">{att.displayName}</p>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {viewable ? (
                        <>
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
                            className="p-2 text-gray-400 hover:text-white hover:bg-white/10 rounded transition-colors"
                            title="More actions"
                          >
                            <EllipsisVerticalIcon className="w-4 h-4" />
                          </button>
                          {openAttachmentMenu === att.filename && menuPosition && createPortal(
                            <div
                              ref={menuRef}
                              className="fixed z-[10003] bg-gray-800 border border-white/10 rounded-lg shadow-xl py-1 min-w-[120px]"
                              style={{ top: menuPosition.top, left: menuPosition.left, transform: 'translate(-100%, -100%)' }}
                            >
                              <button
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  setOpenAttachmentMenu(null);
                                  setViewerAttachment({ url: att.url, filename: att.displayName });
                                }}
                                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-gray-200 hover:bg-white/10 transition-colors"
                              >
                                <EyeIcon className="w-3.5 h-3.5" />
                                Open
                              </button>
                              <button
                                onClick={handleDownload}
                                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-gray-200 hover:bg-white/10 transition-colors"
                              >
                                <ArrowDownTrayIcon className="w-3.5 h-3.5" />
                                Download
                              </button>
                            </div>,
                            window.document.body
                          )}
                        </>
                      ) : (
                        <button
                          onClick={handleDownload}
                          className="p-2 text-blue-400 hover:text-blue-300 hover:bg-blue-600/20 rounded transition-colors"
                          title="Download"
                        >
                          <ArrowDownTrayIcon className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Footer Stats */}
        <div className="p-6 border-t border-white/10 flex items-center justify-between gap-4">
          <div className="flex items-center gap-6 text-sm text-gray-400">
            <div className="flex items-center gap-1.5">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <span>{document.word_count} words</span>
            </div>
            <div className="flex items-center gap-1.5">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>{document.reading_time} min read</span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="px-5 py-2.5 bg-gray-700/50 text-gray-300 rounded-lg hover:bg-gray-700 transition-colors text-sm font-medium border border-white/10"
          >
            Close
          </button>
        </div>
      </div>
    </div>,
    window.document.body
  );

  return (
    <>
      {modal}
      <LazyAttachmentViewer
        isOpen={!!viewerAttachment}
        url={viewerAttachment?.url ?? ''}
        filename={viewerAttachment?.filename ?? ''}
        onClose={() => setViewerAttachment(null)}
      />
    </>
  );
}
