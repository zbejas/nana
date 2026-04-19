import { type RefObject, type TouchEvent, useEffect, useRef, useState } from "react";
import { useResponsiveContextMenuPosition } from "./useResponsiveContextMenuPosition";

interface DocumentContextMenuProps {
  contextMenu: {
    x: number;
    y: number;
    type: 'document' | 'trash-document';
    documentId?: string;
  };
  contextMenuRef: RefObject<HTMLDivElement | null>;
  onAddFolder: () => void;
  onAddDocument: () => void;
  onRenameDocument: () => void;
  onMakePublicDocument: () => void;
  onDeleteDocument: () => void;
  onRestoreDocument: () => void;
  onPermanentlyDeleteDocument: () => void;
  onExportDocument: () => void;
  onClose: () => void;
  mode?: 'default' | 'timeline';
  isClosing?: boolean;
}

export function DocumentContextMenu({
  contextMenu,
  contextMenuRef,
  onAddFolder,
  onAddDocument,
  onRenameDocument,
  onMakePublicDocument,
  onDeleteDocument,
  onRestoreDocument,
  onPermanentlyDeleteDocument,
  onExportDocument,
  onClose,
  mode = 'default',
  isClosing = false,
}: DocumentContextMenuProps) {
  const [showExportSubmenu, setShowExportSubmenu] = useState(false);
  const [sheetOffsetY, setSheetOffsetY] = useState(0);
  const [isDraggingSheet, setIsDraggingSheet] = useState(false);
  const [hasEnteredMobileSheet, setHasEnteredMobileSheet] = useState(false);
  const sheetDragStartYRef = useRef<number | null>(null);
  const { position, submenuPosition, isMobile } = useResponsiveContextMenuPosition({
    contextMenuRef,
    x: contextMenu.x,
    y: contextMenu.y,
  });
  const isTimelineMode = mode === 'timeline';
  const isSheetVisible = hasEnteredMobileSheet && !isClosing;

  useEffect(() => {
    if (!isMobile) {
      setHasEnteredMobileSheet(false);
      return;
    }

    setHasEnteredMobileSheet(false);
    const frame = requestAnimationFrame(() => {
      setHasEnteredMobileSheet(true);
    });

    return () => {
      cancelAnimationFrame(frame);
    };
  }, [isMobile, showExportSubmenu, contextMenu.type, contextMenu.documentId]);

  const resetSheetPosition = () => {
    setSheetOffsetY(0);
    setIsDraggingSheet(false);
    sheetDragStartYRef.current = null;
  };

  const handleSheetTouchStart = (event: TouchEvent<HTMLDivElement>) => {
    if (event.touches.length !== 1) {
      return;
    }

    setIsDraggingSheet(true);
    sheetDragStartYRef.current = event.touches[0]?.clientY ?? null;
  };

  const handleSheetTouchMove = (event: TouchEvent<HTMLDivElement>) => {
    if (!isDraggingSheet || sheetDragStartYRef.current === null || event.touches.length !== 1) {
      return;
    }

    const currentY = event.touches[0]?.clientY ?? sheetDragStartYRef.current;
    const deltaY = Math.max(0, currentY - sheetDragStartYRef.current);
    setSheetOffsetY(deltaY);
  };

  const handleSheetTouchEnd = () => {
    if (sheetOffsetY > 80) {
      onClose();
      setShowExportSubmenu(false);
      resetSheetPosition();
      return;
    }

    resetSheetPosition();
  };

  const sheetStyle = {
    transform: isClosing
      ? `translateY(calc(100% + ${sheetOffsetY}px))`
      : !hasEnteredMobileSheet
        ? `translateY(calc(100% + ${sheetOffsetY}px))`
      : `translateY(${sheetOffsetY}px)`,
    transition: isDraggingSheet ? 'none' : 'transform 220ms cubic-bezier(0.22, 1, 0.36, 1)',
  };

  // Export submenu bottom sheet (mobile only)
  if (isMobile && showExportSubmenu) {
    return (
      <>
        <div
          className={`fixed inset-0 bg-black/50 backdrop-blur-sm z-[80] transition-opacity duration-180 ease-out ${isSheetVisible ? 'opacity-100' : 'opacity-0'}`}
          onClick={() => {
            setShowExportSubmenu(false);
            resetSheetPosition();
          }}
        />
        
        <div
          className={`fixed bottom-0 left-0 right-0 bg-black/90 backdrop-blur-xl border-t-2 border-white/15 rounded-t-2xl shadow-2xl z-[90] transition-opacity duration-180 ease-out ${isSheetVisible ? 'opacity-100' : 'opacity-0'}`}
          style={sheetStyle}
        >
          <div
            className="flex justify-center py-3 touch-pan-y"
            onTouchStart={handleSheetTouchStart}
            onTouchMove={handleSheetTouchMove}
            onTouchEnd={handleSheetTouchEnd}
            onTouchCancel={handleSheetTouchEnd}
          >
            <div className="w-12 h-1 bg-white/30 rounded-full" />
          </div>

          <div className="pb-safe-area-inset-bottom">
            <button
              onClick={() => {
                onExportDocument();
                setShowExportSubmenu(false);
                onClose();
              }}
              className="w-full px-6 py-4 text-left text-blue-300 active:bg-blue-500/20 transition-colors flex items-center gap-3 border-t border-white/10"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
              </svg>
              <span className="text-base">Markdown</span>
            </button>
            <button
              disabled
              className="w-full px-6 py-4 text-left text-gray-500 cursor-not-allowed transition-colors flex items-center gap-3 border-t border-white/10 opacity-50"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
              </svg>
              <span className="text-base">PDF (Coming Soon)</span>
            </button>
            
            <button
              onClick={() => setShowExportSubmenu(false)}
              className="w-full px-6 py-4 text-center text-gray-400 active:bg-white/5 transition-colors border-t-2 border-white/20 mt-2"
            >
              <span className="text-base font-medium">Back</span>
            </button>
          </div>
        </div>
      </>
    );
  }

  // Mobile bottom sheet menu
  if (isMobile) {
    return (
      <>
        <div
          className={`fixed inset-0 bg-black/50 backdrop-blur-sm z-[60] transition-opacity duration-180 ease-out ${isSheetVisible ? 'opacity-100' : 'opacity-0'}`}
          onClick={onClose}
        />
        
        <div
          ref={contextMenuRef}
          className={`fixed bottom-0 left-0 right-0 bg-black/90 backdrop-blur-xl border-t-2 border-white/15 rounded-t-2xl shadow-2xl z-[70] transition-opacity duration-180 ease-out ${isSheetVisible ? 'opacity-100' : 'opacity-0'}`}
          style={sheetStyle}
        >
          <div
            className="flex justify-center py-3 touch-pan-y"
            onTouchStart={handleSheetTouchStart}
            onTouchMove={handleSheetTouchMove}
            onTouchEnd={handleSheetTouchEnd}
            onTouchCancel={handleSheetTouchEnd}
          >
            <div className="w-12 h-1 bg-white/30 rounded-full" />
          </div>

          <div className="pb-safe-area-inset-bottom">
            {contextMenu.type === 'document' && contextMenu.documentId && (
              <>
                {!isTimelineMode && (
                  <>
                    <button
                      onClick={() => { onAddFolder(); onClose(); }}
                      className="w-full px-6 py-4 text-left text-gray-300 active:bg-white/10 transition-colors flex items-center gap-3 border-t border-white/10"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
                      </svg>
                      <span className="text-base">New Folder</span>
                    </button>
                    <button
                      onClick={() => { onAddDocument(); onClose(); }}
                      className="w-full px-6 py-4 text-left text-gray-300 active:bg-white/10 transition-colors flex items-center gap-3 border-t border-white/10"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      <span className="text-base">New Document</span>
                    </button>
                    <button
                      onClick={() => { onRenameDocument(); onClose(); }}
                      className="w-full px-6 py-4 text-left text-gray-300 active:bg-white/10 transition-colors flex items-center gap-3 border-t border-white/10"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                      <span className="text-base">Rename</span>
                    </button>
                  </>
                )}
                <button
                  onClick={() => { onMakePublicDocument(); onClose(); }}
                  className="w-full px-6 py-4 text-left text-cyan-200 active:bg-cyan-500/20 transition-colors flex items-center gap-3 border-t border-white/10"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7.217 10.907a2.25 2.25 0 1 0 0 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186l9.566-5.314m-9.566 7.5 9.566 5.314m0 0a2.25 2.25 0 1 0 3.935 2.186 2.25 2.25 0 0 0-3.935-2.186Zm0-12.814a2.25 2.25 0 1 0 3.933-2.185 2.25 2.25 0 0 0-3.933 2.185Z" />
                  </svg>
                  <span className="text-base">Share Options</span>
                </button>
                <button
                  onClick={() => setShowExportSubmenu(true)}
                  className="w-full px-6 py-4 text-left text-blue-300 active:bg-blue-500/20 transition-colors flex items-center gap-3 border-t border-white/10"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  <span className="text-base">Export as</span>
                </button>
                <button
                  onClick={() => { onDeleteDocument(); onClose(); }}
                  className="w-full px-6 py-4 text-left text-red-300 active:bg-red-500/20 transition-colors flex items-center gap-3 border-t border-white/10"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                  <span className="text-base">Delete</span>
                </button>
              </>
            )}
            {contextMenu.type === 'trash-document' && (
              <>
                <button
                  onClick={() => { onRestoreDocument(); onClose(); }}
                  className="w-full px-6 py-4 text-left text-green-300 active:bg-green-500/20 transition-colors flex items-center gap-3 border-t border-white/10"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  <span className="text-base">Restore</span>
                </button>
                <button
                  onClick={() => { onPermanentlyDeleteDocument(); onClose(); }}
                  className="w-full px-6 py-4 text-left text-red-300 active:bg-red-500/20 transition-colors flex items-center gap-3 border-t border-white/10"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                  <span className="text-base">Delete Forever</span>
                </button>
              </>
            )}
          </div>
        </div>
      </>
    );
  }

  // Desktop popup menu
  return (
    <>
      <div
        className={`fixed inset-0 z-[60] transition-opacity duration-150 ease-out ${isClosing ? 'opacity-0' : 'opacity-100'}`}
        onClick={onClose}
      />
      <div
        ref={contextMenuRef}
        className={`fixed bg-black/60 backdrop-blur-xl border-2 border-white/15 rounded-lg shadow-lg min-w-[200px] z-[70] transform-gpu transition-[opacity,transform] duration-150 ease-out ${isClosing ? 'opacity-0 scale-95' : 'opacity-100 scale-100 animate-in zoom-in-95 fade-in duration-150 ease-out'}`}
        style={{
          top: position.top,
          left: position.left,
          right: position.right,
        }}
      >
        {contextMenu.type === 'document' && contextMenu.documentId && (
          <>
            {!isTimelineMode && (
              <>
                <button
                  onClick={onAddFolder}
                  className="w-full px-4 py-3 text-left text-gray-300 hover:bg-white/10 active:bg-white/20 hover:text-white transition-colors flex items-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
                  </svg>
                  New Folder
                </button>
                <button
                  onClick={onAddDocument}
                  className="w-full px-4 py-3 text-left text-gray-300 hover:bg-white/10 active:bg-white/20 hover:text-white transition-colors flex items-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  New Document
                </button>
                <button
                  onClick={onRenameDocument}
                  className="w-full px-4 py-3 text-left text-gray-300 hover:bg-white/10 active:bg-white/20 hover:text-white transition-colors flex items-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                  Rename
                </button>
              </>
            )}
            <button
              onClick={onMakePublicDocument}
              className="w-full px-4 py-3 text-left text-cyan-200 hover:bg-cyan-500/20 active:bg-cyan-500/30 hover:text-white transition-colors flex items-center gap-2 border-t border-white/10"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7.217 10.907a2.25 2.25 0 1 0 0 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186l9.566-5.314m-9.566 7.5 9.566 5.314m0 0a2.25 2.25 0 1 0 3.935 2.186 2.25 2.25 0 0 0-3.935-2.186Zm0-12.814a2.25 2.25 0 1 0 3.933-2.185 2.25 2.25 0 0 0-3.933 2.185Z" />
              </svg>
              Share Options
            </button>
            <div 
              className="relative border-t border-white/10"
              onMouseEnter={() => setShowExportSubmenu(true)}
              onMouseLeave={() => setShowExportSubmenu(false)}
            >
              <button
                className="w-full px-4 py-3 text-left text-blue-300 hover:bg-blue-500/20 active:bg-blue-500/30 hover:text-white transition-colors flex items-center justify-between gap-2"
              >
                <div className="flex items-center gap-2">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  Export as
                </div>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
              {showExportSubmenu && (
                <div 
                  className={`absolute ${submenuPosition === 'right' ? 'left-full' : 'right-full'} top-0 bg-black/60 backdrop-blur-xl border-2 border-white/15 rounded-lg shadow-lg min-w-[150px] z-[70] animate-in zoom-in-95 fade-in duration-150 ease-out`}
                >
                  <button
                    onClick={onExportDocument}
                    className="w-full px-4 py-3 text-left text-gray-300 hover:bg-white/10 active:bg-white/20 hover:text-white transition-colors"
                  >
                    Markdown
                  </button>
                  <button
                    disabled
                    className="w-full px-4 py-3 text-left text-gray-400 cursor-not-allowed opacity-60"
                  >
                    PDF
                  </button>
                </div>
              )}
            </div>
            <button
              onClick={onDeleteDocument}
              className="w-full px-4 py-3 text-left text-red-300 hover:bg-red-500/20 active:bg-red-500/30 hover:text-white transition-colors flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              Delete
            </button>
          </>
        )}
        {contextMenu.type === 'trash-document' && (
          <>
            <button
              onClick={onRestoreDocument}
              className="w-full px-4 py-3 text-left text-green-300 hover:bg-green-500/20 active:bg-green-500/30 hover:text-white transition-colors flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Restore
            </button>
            <button
              onClick={onPermanentlyDeleteDocument}
              className="w-full px-4 py-3 text-left text-red-300 hover:bg-red-500/20 active:bg-red-500/30 hover:text-white transition-colors flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              Delete Forever
            </button>
          </>
        )}
      </div>
    </>
  );
}
