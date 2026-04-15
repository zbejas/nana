import { PencilSquareIcon, EyeIcon, ViewColumnsIcon, XMarkIcon, BookmarkIcon, ChevronUpIcon } from '@heroicons/react/24/outline';

type ViewMode = 'text' | 'preview' | 'split';

interface EditorHeaderProps {
  title: string;
  onTitleChange: (title: string) => void;
  readOnly?: boolean;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  published: boolean;
  onPublishedChange: (published: boolean) => void;
  onCancel: () => void;
  onPublish: () => void;
  publishing: boolean;
  hasUnsavedChanges: boolean;
  isNewDocument?: boolean;
  autoSaving?: boolean;
  headerVisible?: boolean;
  onToggleHeader?: () => void;
  titleInputRef?: React.RefObject<HTMLInputElement | null>;
}

export function EditorHeader({
  title,
  onTitleChange,
  readOnly = false,
  viewMode,
  onViewModeChange,
  published,
  onPublishedChange,
  onCancel,
  onPublish,
  publishing,
  hasUnsavedChanges,
  isNewDocument = false,
  autoSaving = false,
  headerVisible = true,
  onToggleHeader,
  titleInputRef,
}: EditorHeaderProps) {
  const handleCancel = () => {
    onCancel();
  };

  const getViewModeButtonClass = (isActive: boolean) =>
    `p-1.5 sm:p-2 transition-colors border-r border-white/10 last:border-r-0 ${
      isActive
        ? 'bg-blue-500/20 text-blue-100'
        : 'bg-transparent text-gray-300 hover:bg-white/10 light:text-gray-700 light:hover:bg-gray-200'
    }`;

  const secondaryActionClass =
    'p-1.5 sm:p-2 rounded-lg border border-white/10 bg-white/5 text-gray-300 hover:bg-white/10 transition-colors light:bg-gray-100 light:border-gray-300 light:text-gray-700 light:hover:bg-gray-200';

  return (
    <div className="flex items-center justify-between gap-2 p-2 sm:p-4 border-b border-white/10 dark:border-white/10 light:border-gray-300 bg-white/5 dark:bg-white/5 light:bg-white/70 backdrop-blur-sm">
      <div className="flex-1 flex items-center gap-3 min-w-0">
        <input
          ref={titleInputRef}
          type="text"
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          readOnly={readOnly}
          placeholder="Untitled"
          aria-label="Document title"
          autoFocus={isNewDocument}
          tabIndex={1}
          className="flex-1 min-w-0 text-lg sm:text-2xl font-bold bg-transparent border-none outline-none text-white dark:text-white light:text-gray-900 placeholder-gray-500 dark:placeholder-gray-500 light:placeholder-gray-400"
        />
        {/* Auto-save indicator */}
        {autoSaving && (
          <div className="flex items-center gap-2 text-sm text-gray-400 light:text-gray-500 whitespace-nowrap">
            <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
            <span className="hidden sm:inline">Saving...</span>
          </div>
        )}
      </div>
      <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
        {/* View Mode Toggle - Mobile: text/preview only, Desktop: all three */}
        <div className="flex items-center rounded-lg overflow-hidden border border-white/10 bg-white/5 light:bg-gray-100 light:border-gray-300">
          <button
            onClick={() => onViewModeChange('text')}
            aria-label="Switch to text view"
            className={getViewModeButtonClass(viewMode === 'text')}
            title="Text Only"
          >
            <PencilSquareIcon className="w-4 h-4" />
          </button>
          <button
            onClick={() => onViewModeChange('split')}
            aria-label="Switch to split view"
            className={`hidden md:block ${getViewModeButtonClass(viewMode === 'split')}`}
            title="Split View"
          >
            <ViewColumnsIcon className="w-4 h-4" />
          </button>
          <button
            onClick={() => onViewModeChange('preview')}
            aria-label="Switch to preview view"
            className={getViewModeButtonClass(viewMode === 'preview')}
            title="Preview Only"
          >
            <EyeIcon className="w-4 h-4" />
          </button>
        </div>
        
        {/* Publish Version Button */}
        <button
          onClick={onPublish}
          disabled={readOnly || publishing || isNewDocument}
          aria-label={isNewDocument ? 'Save document first to publish' : publishing ? 'Publishing version' : 'Publish version'}
          className={`p-1.5 sm:p-2 rounded-lg border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
            publishing
              ? 'border-blue-500/30 bg-blue-500/20 text-blue-100'
              : 'border-white/10 bg-white/5 text-gray-300 hover:bg-white/10 light:bg-gray-100 light:border-gray-300 light:text-gray-700 light:hover:bg-gray-200'
          }`}
          title={isNewDocument ? 'Save document first to publish' : publishing ? 'Publishing...' : 'Publish Version'}
        >
          <BookmarkIcon className="w-5 h-5 sm:w-4 sm:h-4" />
        </button>

        {onToggleHeader && (
          <button
            onClick={onToggleHeader}
            aria-label="Hide header"
            className={secondaryActionClass}
            title="Hide header"
          >
            <ChevronUpIcon className="w-5 h-5 sm:w-4 sm:h-4" />
          </button>
        )}
        
        <button
          onClick={handleCancel}
          disabled={publishing || autoSaving}
          aria-label={autoSaving ? 'Saving document' : 'Cancel and close editor'}
          className={`${secondaryActionClass} disabled:opacity-50`}
          title={autoSaving ? "Saving..." : "Cancel"}
        >
          {autoSaving ? (
            <div className="w-5 h-5 sm:w-4 sm:h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
          ) : (
            <XMarkIcon className="w-5 h-5 sm:w-4 sm:h-4" />
          )}
        </button>
      </div>
    </div>
  );
}

export type { ViewMode };
