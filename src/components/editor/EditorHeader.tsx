import { ArrowsPointingInIcon, ArrowsPointingOutIcon, CodeBracketIcon, PencilSquareIcon, SparklesIcon, XMarkIcon, ViewColumnsIcon } from '@heroicons/react/24/outline';
import { EditorContextMenu } from './EditorContextMenu';
import { IconButton, SegmentedControl } from '../ui';
import { EditorPresence } from './EditorPresence';
import type { Collaborator } from '../../lib/collaboration/types';

type ViewMode = 'wysiwyg' | 'text' | 'split';

interface EditorHeaderProps {
  title: string;
  onTitleChange: (title: string) => void;
  readOnly?: boolean;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  /** Phones expose Editor and Source only; split stays a desktop surface. */
  isMobile?: boolean;
  onCancel: () => void;
  onPublish: () => void;
  publishing: boolean;
  hasUnsavedChanges: boolean;
  isNewDocument?: boolean;
  autoSaving?: boolean;
  collaborators?: Collaborator[];
  onToggleHeader?: () => void;
  titleInputRef?: React.RefObject<HTMLInputElement | null>;
  onShare?: () => void;
  onExport?: () => void;
  onDelete?: () => void;
  onAskNana?: () => void;
  askNanaDisabled?: boolean;
  fullscreen?: boolean;
  onToggleFullscreen?: () => void;
}

export function EditorHeader({
  title,
  onTitleChange,
  readOnly = false,
  viewMode,
  onViewModeChange,
  isMobile = false,
  onCancel,
  onPublish,
  publishing,
  hasUnsavedChanges,
  isNewDocument = false,
  autoSaving = false,
  collaborators = [],
  onToggleHeader,
  titleInputRef,
  onShare,
  onExport,
  onDelete,
  onAskNana,
  askNanaDisabled = false,
  fullscreen = false,
  onToggleFullscreen,
}: EditorHeaderProps) {
  const editorOption = { value: 'wysiwyg' as const, label: 'Editor', icon: <PencilSquareIcon className="h-3.5 w-3.5" /> };
  const sourceOption = { value: 'text' as const, label: 'Source', icon: <CodeBracketIcon className="h-3.5 w-3.5" /> };
  const splitOption = { value: 'split' as const, label: 'Split', icon: <ViewColumnsIcon className="h-3.5 w-3.5" /> };
  const nextView: ViewMode = isMobile
    ? viewMode === 'text'
      ? 'wysiwyg'
      : 'text'
    : viewMode === 'wysiwyg' ? 'text' : viewMode === 'text' ? 'split' : 'wysiwyg';
  const mobileViewLabel = viewMode === 'text'
    ? 'Switch to editor view'
    : 'Switch to source view';

  return (
    <div className="editor-header border-b border-line bg-canvas">
      <div className="editor-header-row flex items-center gap-2 px-3 py-2.5 sm:px-5">
        <div className="editor-header-title-group flex min-w-0 flex-1 items-center gap-3">
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
            <span
              className="flex shrink-0 items-center gap-1.5 text-[11.5px] text-ink-muted"
              aria-label="Saving document"
              title="Saving document"
            >
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-signal" />
              <span className="hidden sm:inline">Saving</span>
            </span>
          ) : hasUnsavedChanges ? (
            <span
              className="flex shrink-0 items-center gap-1.5 text-[11.5px] font-medium text-warning"
              aria-label="Unsaved changes"
              title="Unsaved changes"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-warning" />
              <span className="hidden sm:inline">Unsaved</span>
            </span>
          ) : null}
        </div>

        <EditorPresence collaborators={collaborators} className="mr-1 hidden sm:flex" />

        <div className="editor-header-actions flex shrink-0 items-center gap-1">
          <span className="md:hidden">
            <IconButton
              label={mobileViewLabel}
              size="md"
              className="h-11 w-11 sm:h-8 sm:w-8"
              onClick={() => onViewModeChange(nextView)}
            >
              {viewMode === 'text' ? <PencilSquareIcon /> : <CodeBracketIcon />}
            </IconButton>
          </span>
          <span className="hidden md:inline-flex">
            <SegmentedControl
              label="Editor view"
              value={viewMode}
              onChange={onViewModeChange}
              size="sm"
              options={[editorOption, sourceOption, splitOption]}
            />
          </span>

          <span className="mx-0.5 hidden h-5 w-px bg-line sm:block" aria-hidden="true" />

          {onAskNana && (
            <IconButton
              label={askNanaDisabled ? 'Save the note before asking Nana' : 'Ask Nana about this note'}
              size="md"
              className="h-11 w-11 text-signal sm:h-8 sm:w-8"
              onClick={onAskNana}
              disabled={askNanaDisabled}
            >
              <SparklesIcon />
            </IconButton>
          )}

          {onToggleFullscreen && (
            <IconButton
              label={fullscreen ? 'Exit fullscreen editor' : 'Expand editor to fullscreen'}
              size="md"
              className="h-11 w-11 sm:h-8 sm:w-8"
              onClick={onToggleFullscreen}
            >
              {fullscreen ? <ArrowsPointingInIcon /> : <ArrowsPointingOutIcon />}
            </IconButton>
          )}

          {onShare && onExport && onDelete && (
            <EditorContextMenu
              onShare={onShare}
              onExport={onExport}
              onPublish={onPublish}
              publishing={publishing}
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
