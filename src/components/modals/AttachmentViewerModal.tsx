import { useEffect, useState, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import { XMarkIcon, PlusIcon, MinusIcon, ArrowsPointingOutIcon } from '@heroicons/react/24/outline';
import { isPdfFile, isImageFile, isTextFile } from '../../lib/documents';

pdfjs.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.mjs';

export interface AttachmentViewerModalProps {
  isOpen: boolean;
  url: string;
  filename: string;
  onClose: () => void;
}

const MIN_SCALE = 0.5;
const MAX_SCALE = 3;
const SCALE_STEP = 0.25;

function PdfContent({ url }: { url: string }) {
  const [numPages, setNumPages] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [baseWidth, setBaseWidth] = useState<number>(800);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width) setBaseWidth(Math.min(width - 32, 1200));
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const delta = e.deltaY > 0 ? -SCALE_STEP : SCALE_STEP;
      setScale((s) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s + delta)));
    };
    container.addEventListener('wheel', onWheel, { passive: false });
    return () => container.removeEventListener('wheel', onWheel);
  }, []);

  return (
    <div ref={containerRef} className="h-full overflow-auto bg-[#1a1a1a] relative">
      <Document
        file={url}
        onLoadSuccess={({ numPages }) => setNumPages(numPages)}
        loading={<div className="flex items-center justify-center h-full text-gray-400 text-sm">Loading PDF…</div>}
        error={<div className="flex items-center justify-center h-full text-red-400 text-sm">Failed to load PDF.</div>}
      >
        {numPages && Array.from({ length: numPages }, (_, i) => (
          <div key={i + 1} className="flex justify-center py-2">
            <Page
              pageNumber={i + 1}
              width={baseWidth * scale}
              renderAnnotationLayer
              renderTextLayer
            />
          </div>
        ))}
      </Document>

      {/* Zoom controls */}
      <div
        className="sticky bottom-4 left-0 right-0 flex justify-center pointer-events-none z-10"
      >
        <div className="flex items-center gap-1 bg-black/70 backdrop-blur-sm border border-white/15 rounded-lg px-2 py-1.5 shadow-lg pointer-events-auto">
          <button
            onClick={() => setScale((s) => Math.max(MIN_SCALE, s - SCALE_STEP))}
            className="p-1 text-gray-300 hover:text-white hover:bg-white/10 rounded transition-colors"
            title="Zoom out"
          >
            <MinusIcon className="w-4 h-4" />
          </button>
          <span className="text-xs text-gray-300 w-12 text-center tabular-nums">{Math.round(scale * 100)}%</span>
          <button
            onClick={() => setScale((s) => Math.min(MAX_SCALE, s + SCALE_STEP))}
            className="p-1 text-gray-300 hover:text-white hover:bg-white/10 rounded transition-colors"
            title="Zoom in"
          >
            <PlusIcon className="w-4 h-4" />
          </button>
          <div className="w-px h-4 bg-white/15 mx-0.5" />
          <button
            onClick={() => setScale(1)}
            className="p-1 text-gray-300 hover:text-white hover:bg-white/10 rounded transition-colors"
            title="Reset zoom"
          >
            <ArrowsPointingOutIcon className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

function TextContent({ url }: { url: string }) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setText(null);
    setError(null);

    fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load file (${res.status})`);
        return res.text();
      })
      .then((content) => { if (!cancelled) setText(content); })
      .catch((err) => { if (!cancelled) setError(err.message); });

    return () => { cancelled = true; };
  }, [url]);

  if (error) {
    return (
      <div className="flex items-center justify-center h-full text-red-400 text-sm">
        {error}
      </div>
    );
  }

  if (text === null) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400 text-sm">
        Loading…
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto px-4 py-4 md:px-6 md:py-5">
      <pre className="text-sm text-gray-200 font-mono whitespace-pre-wrap break-words leading-relaxed">{text}</pre>
    </div>
  );
}

export default function AttachmentViewerModal({
  isOpen,
  url,
  filename,
  onClose,
}: AttachmentViewerModalProps) {
  const [zoom, setZoom] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const positionRef = useRef({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  const MIN_ZOOM = 0.25;
  const MAX_ZOOM = 8;
  const ZOOM_STEP = 0.25;

  const resetView = useCallback(() => {
    setZoom(1);
    setPosition({ x: 0, y: 0 });
    positionRef.current = { x: 0, y: 0 };
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    resetView();
  }, [isOpen, url, resetView]);

  useEffect(() => {
    if (!isOpen) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  // Wheel zoom for images
  useEffect(() => {
    if (!isOpen || !isImageFile(filename)) return;
    const container = containerRef.current;
    if (!container) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
      setZoom((z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z + delta)));
    };

    container.addEventListener('wheel', onWheel, { passive: false });
    return () => container.removeEventListener('wheel', onWheel);
  }, [isOpen, filename]);

  const handlePointerDown = (e: React.PointerEvent) => {
    if (zoom <= 1) return;
    setIsDragging(true);
    dragStart.current = { x: e.clientX - positionRef.current.x, y: e.clientY - positionRef.current.y };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging) return;
    const newPos = { x: e.clientX - dragStart.current.x, y: e.clientY - dragStart.current.y };
    positionRef.current = newPos;
    setPosition(newPos);
  };

  const handlePointerUp = () => {
    setIsDragging(false);
  };

  const handleDoubleClick = () => {
    if (zoom > 1) {
      resetView();
    } else {
      setZoom(3);
    }
  };

  if (!isOpen) return null;

  const renderContent = () => {
    if (isPdfFile(filename)) {
      return (
        <div className="flex-1 min-h-0" style={{ height: '100%' }}>
          <PdfContent url={url} />
        </div>
      );
    }

    if (isImageFile(filename)) {
      return (
        <div
          ref={containerRef}
          className="flex-1 overflow-hidden relative select-none"
          style={{ height: '100%', cursor: zoom > 1 ? (isDragging ? 'grabbing' : 'grab') : 'zoom-in' }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onDoubleClick={handleDoubleClick}
        >
          <div className="w-full h-full flex items-center justify-center">
            <img
              src={url}
              alt={filename}
              draggable={false}
              className="max-w-full max-h-full object-contain transition-transform duration-150 ease-out"
              style={{
                transform: `translate(${position.x}px, ${position.y}px) scale(${zoom})`,
                transformOrigin: 'center center',
              }}
              onError={() => {}}
            />
          </div>

          {/* Zoom controls */}
          <div
            className="absolute left-1/2 -translate-x-1/2 flex items-center gap-1 bg-black/70 backdrop-blur-sm border border-white/15 rounded-lg px-2 py-1.5 shadow-lg"
            style={{ bottom: 'max(1rem, env(safe-area-inset-bottom))' }}
          >
            <button
              onClick={(e) => { e.stopPropagation(); setZoom((z) => Math.max(MIN_ZOOM, z - ZOOM_STEP)); }}
              className="p-1 text-gray-300 hover:text-white hover:bg-white/10 rounded transition-colors"
              title="Zoom out"
            >
              <MinusIcon className="w-4 h-4" />
            </button>
            <span className="text-xs text-gray-300 w-12 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
            <button
              onClick={(e) => { e.stopPropagation(); setZoom((z) => Math.min(MAX_ZOOM, z + ZOOM_STEP)); }}
              className="p-1 text-gray-300 hover:text-white hover:bg-white/10 rounded transition-colors"
              title="Zoom in"
            >
              <PlusIcon className="w-4 h-4" />
            </button>
            <div className="w-px h-4 bg-white/15 mx-0.5" />
            <button
              onClick={(e) => { e.stopPropagation(); resetView(); }}
              className="p-1 text-gray-300 hover:text-white hover:bg-white/10 rounded transition-colors"
              title="Reset view"
            >
              <ArrowsPointingOutIcon className="w-4 h-4" />
            </button>
          </div>
        </div>
      );
    }

    if (isTextFile(filename)) {
      return (
        <div className="flex-1 min-h-0" style={{ height: '100%' }}>
          <TextContent url={url} />
        </div>
      );
    }

    return (
      <div className="flex items-center justify-center h-full text-gray-400 text-sm">
        Preview not available for this file type.
      </div>
    );
  };

  return createPortal(
    <div className="fixed inset-0 z-[10002] flex items-stretch md:items-center md:justify-center md:p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-md"
        onClick={onClose}
      />

      {/* Modal */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Viewing ${filename}`}
        className="relative flex h-full w-full flex-col overflow-hidden bg-black/95 backdrop-blur-sm md:max-h-[90vh] md:max-w-6xl md:rounded-2xl md:border md:border-white/10 md:shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 px-4 pb-3 pt-[max(1rem,env(safe-area-inset-top))] md:px-4 md:py-3 flex-shrink-0">
          <h3 className="text-sm font-medium text-gray-200 truncate mr-4 md:text-sm">
            {filename}
          </h3>
          <button
            onClick={onClose}
            aria-label="Close viewer"
            className="text-gray-400 hover:text-white transition-colors p-2 rounded-lg hover:bg-white/10 flex-shrink-0"
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 min-h-0 bg-black/40">
          {renderContent()}
        </div>
      </div>
    </div>,
    window.document.body,
  );
}
