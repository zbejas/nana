import { BookmarkIcon, EyeIcon, PencilSquareIcon, XMarkIcon, ViewColumnsIcon } from '@heroicons/react/24/outline';
import { EditorContextMenu } from './EditorContextMenu';
import { IconButton, SegmentedControl } from '../ui';

type ViewMode = 'text' | 'preview' | 'split';

interface EditorHeaderProps {
  title: string;
  onTitleChange: (title: string) => void;
  readOnly?: boolean;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  onCancel: () => void;
  onPublish: () => void;
  publishing: boolean;
  hasUnsavedChanges: boolean;
  isNewDocument?: boolean;
  autoSaving?: boolean;
  onToggleHeader?: () => void;
  titleInputRef?: React.RefObject<HTMLInputElement | null>;
  onShare?: () => void;
  onExport?: () => void;
  onDelete?: () => void;
}

export function EditorHeader({
  title,
  onTitleChange,
  readOnly = false,
  viewMode,
  onViewModeChange,
  onCancel,
  onPublish,
  publishing,
  hasUnsavedChanges,
  isNewDocument = false,
  autoSaving = false,
  onToggleHeader,
  titleInputRef,
  onShare,
  onExport,
  onDelete,
}: EditorHeaderProps) {
  const textOption = { value: 'text' as const, label: 'Write', icon: <PencilSquareIcon className="h-3.5 w-3.5" /> };
  const previewOption = { value: 'preview' as const, label: 'Read', icon: <EyeIcon className="h-3.5 w-3.5" /> };
  const splitOption = { value: 'split' as const, label: 'Split', icon: <ViewColumnsIcon className="h-3.5 w-3.5" /> };

  return (
    <div className="border-b border-line bg-canvas">
      <div className="flex items-center gap-2 px-3 py-2.5 sm:px-5">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <input
            ref={titleInputRef}
            type="text"
            value={title}
            onChange={(event) => onTitleChange(event.target.value)}
            readOnly={readOnly}
            placeholder="Untitled"
            aria-label="Document title"
            autoFocus={isNewDocument}
            tabIndex={1}
            className="min-w-0 flex-1 rounded-[4px] border-none bg-transparent px-1 -mx-1 text-[17px] font-semibold leading-tight tracking-[-0.025em] text-ink placeholder:text-ink-muted focus-visible:bg-surface-raised sm:text-[22px]"
          />
          {autoSaving ? (
            <span className="hidden shrink-0 items-center gap-1.5 text-[11.5px] text-ink-muted sm:flex">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-signal" />
              Saving
            </span>
          ) : hasUnsavedChanges ? (
            <span className="hidden shrink-0 text-[11.5px] font-medium text-warning sm:block">
              Unsaved
            </span>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <span className="md:hidden">
            <IconButton
              label={viewMode === 'preview' ? 'Switch to write view' : 'Switch to read view'}
              size="md"
              className="h-11 w-11 sm:h-8 sm:w-8"
              onClick={() => onViewModeChange(viewMode === 'preview' ? 'text' : 'preview')}
            >
              {viewMode === 'preview' ? <PencilSquareIcon /> : <EyeIcon />}
            </IconButton>
          </span>
          <span className="hidden md:inline-flex">
            <SegmentedControl
              label="Editor view"
              value={viewMode}
              onChange={onViewModeChange}
              size="sm"
              options={[textOption, splitOption, previewOption]}
            />
          </span>

          <span className="mx-0.5 hidden h-5 w-px bg-line sm:block" aria-hidden="true" />

          <span className="hidden sm:inline-flex">
            <IconButton
              label={isNewDocument ? 'Save the note before publishing a version' : 'Save this version'}
              size="md"
              className="h-11 w-11 sm:h-8 sm:w-8"
              onClick={onPublish}
              disabled={readOnly || publishing || isNewDocument}
            >
              <BookmarkIcon />
            </IconButton>
          </span>

          {onShare && onExport && onDelete && (
            <EditorContextMenu
              onShare={onShare}
              onExport={onExport}
              onDelete={onDelete}
              onHideHeader={onToggleHeader}
              disabled={readOnly}
              isNewDocument={isNewDocument}
            />
          )}

          <IconButton
            label={autoSaving ? 'Saving document' : 'Close editor'}
            size="md"
            className="h-11 w-11 sm:h-8 sm:w-8"
            onClick={onCancel}
            disabled={publishing || autoSaving}
          >
            {autoSaving ? (
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
            ) : (
              <XMarkIcon />
            )}
          </IconButton>
        </div>
      </div>
    </div>
  );
}

export type { ViewMode };
