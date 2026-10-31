import { useEffect, useRef, useState } from 'react';
import {
  ArrowUturnLeftIcon,
  ArrowUturnRightIcon,
  BoldIcon,
  CheckCircleIcon,
  CodeBracketIcon,
  CodeBracketSquareIcon,
  ItalicIcon,
  LinkIcon,
  ListBulletIcon,
  NumberedListIcon,
  ChatBubbleBottomCenterTextIcon,
  StrikethroughIcon,
} from '@heroicons/react/24/outline';
import { Button, IconButton, Input, cn } from '../../ui';
import type { EditorActionId } from './helpers';
import { safeLinkHref } from './helpers';
import type { EditorToolbarState } from './editorActions';

interface NanaEditorToolbarProps {
  toolbar: EditorToolbarState;
  onAction: (action: EditorActionId) => void;
  onLink: (href: string) => void;
  onLinkStart?: () => void;
  onLinkCancel?: () => void;
  compact?: boolean;
  className?: string;
}

const iconClass = 'h-7 w-7 [&>svg]:h-4 [&>svg]:w-4';

function keepSelection(event: React.MouseEvent) {
  // Toolbar clicks must not blur ProseMirror or the selection collapses.
  event.preventDefault();
}

export function NanaEditorToolbar({ toolbar, onAction, onLink, onLinkStart, onLinkCancel, compact = false, className }: NanaEditorToolbarProps) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkHref, setLinkHref] = useState('');
  const [linkError, setLinkError] = useState<string | null>(null);
  const linkPanelRef = useRef<HTMLDivElement | null>(null);
  const linkInputRef = useRef<HTMLInputElement | null>(null);
  const iconSize = 'sm';

  useEffect(() => {
    if (!linkOpen) return;
    setLinkHref(toolbar.linkHref);
    setLinkError(null);
    const frame = window.requestAnimationFrame(() => {
      linkInputRef.current?.focus();
      linkInputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [linkOpen, toolbar.linkHref]);

  useEffect(() => {
    if (!linkOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (linkPanelRef.current?.contains(event.target as Node)) return;
      setLinkOpen(false);
    };

    document.addEventListener('pointerdown', handlePointerDown, true);
    return () => document.removeEventListener('pointerdown', handlePointerDown, true);
  }, [linkOpen]);

  const applyLink = () => {
    const safe = safeLinkHref(linkHref);
    if (!safe) {
      setLinkError('Use a web address, mailto link, or /path.');
      return;
    }
    onLink(safe);
    setLinkOpen(false);
    setLinkError(null);
  };

  const renderIcon = (action: EditorActionId, label: string, icon: React.ReactNode, active = false, disabled = false) => (
    <IconButton
      key={action}
      label={label}
      title={label}
      size={iconSize}
      className={cn(iconClass, active && 'bg-signal-soft text-signal hover:bg-signal-soft hover:text-signal')}
      aria-pressed={active || undefined}
      disabled={disabled}
      onMouseDown={keepSelection}
      onClick={() => onAction(action)}
    >
      {icon}
    </IconButton>
  );

  const renderHeading = (action: EditorActionId, level: 1 | 2 | 3) => {
    const active = toolbar.headingLevel === level;
    return (
      <Button
        key={action}
        type="button"
        variant="ghost"
        size="sm"
        aria-label={`Heading ${level}`}
        aria-pressed={active}
        className={cn(
          'h-7 min-w-6 px-1 text-[11.5px] font-semibold tabular-nums',
          active && 'bg-signal-soft text-signal hover:bg-signal-soft hover:text-signal',
        )}
        onMouseDown={keepSelection}
        onClick={() => onAction(action)}
      >
        H{level}
      </Button>
    );
  };

  return (
    <div
      role="toolbar"
      aria-label="Formatting"
      data-nana-editor-toolbar={compact ? 'compact' : 'full'}
      className={cn(
        'relative flex min-w-0 shrink-0 flex-wrap items-center gap-0 border-b border-line bg-surface px-1.5 py-1.5',
        compact && 'gap-0',
        className,
      )}
    >
      {renderIcon('bold', 'Bold', <BoldIcon />, toolbar.bold)}
      {renderIcon('italic', 'Italic', <ItalicIcon />, toolbar.italic)}
      {renderIcon('strike', 'Strikethrough', <StrikethroughIcon />, toolbar.strike)}
      {renderIcon('inline-code', 'Inline code', <CodeBracketIcon />, toolbar.inlineCode)}

      <span className="mx-0.5 h-4 w-px shrink-0 bg-line" aria-hidden="true" />

      {renderHeading('heading-1', 1)}
      {renderHeading('heading-2', 2)}
      {renderHeading('heading-3', 3)}

      <span className="mx-0.5 h-4 w-px shrink-0 bg-line" aria-hidden="true" />

      {renderIcon('bullet-list', 'Bullet list', <ListBulletIcon />, toolbar.bulletList)}
      {renderIcon('ordered-list', 'Numbered list', <NumberedListIcon />, toolbar.orderedList)}
      {renderIcon('task-list', 'Task list', <CheckCircleIcon />, toolbar.taskList)}
      {renderIcon('quote', 'Quote', <ChatBubbleBottomCenterTextIcon />, toolbar.quote)}
      {renderIcon('code-block', 'Code block', <CodeBracketSquareIcon />, toolbar.codeBlock)}

      <span className="mx-0.5 h-4 w-px shrink-0 bg-line" aria-hidden="true" />

      <IconButton
        label="Link"
        title="Link"
        size={iconSize}
        className={cn(iconClass, toolbar.link && 'bg-signal-soft text-signal hover:bg-signal-soft hover:text-signal')}
        aria-pressed={toolbar.link || undefined}
        onMouseDown={(event) => {
          event.preventDefault();
          onLinkStart?.();
        }}
        onClick={() => {
          setLinkHref(toolbar.linkHref);
          setLinkError(null);
          setLinkOpen((open) => !open);
        }}
      >
        <LinkIcon />
      </IconButton>

      <span className="mx-0.5 h-4 w-px shrink-0 bg-line" aria-hidden="true" />

      {renderIcon('undo', 'Undo', <ArrowUturnLeftIcon />, false, !toolbar.canUndo)}
      {renderIcon('redo', 'Redo', <ArrowUturnRightIcon />, false, !toolbar.canRedo)}

      {linkOpen && (
        <div
          ref={linkPanelRef}
          className="absolute left-2 right-2 top-full z-30 mt-1 rounded-panel border border-line bg-surface-raised p-2 shadow-float sm:left-auto sm:right-2 sm:w-80"
        >
          <div className="flex items-center gap-2">
            <Input
              ref={linkInputRef}
              value={linkHref}
              onChange={(event) => {
                setLinkHref(event.target.value);
                setLinkError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  applyLink();
                }
                if (event.key === 'Escape') {
                  event.preventDefault();
                  setLinkOpen(false);
                  onLinkCancel?.();
                }
              }}
              placeholder="https://example.com"
              aria-label="Link address"
              aria-invalid={Boolean(linkError) || undefined}
              className="h-8 text-[12.5px]"
            />
            <Button type="button" variant="primary" size="sm" className="h-8 shrink-0" onMouseDown={keepSelection} onClick={applyLink}>
              Apply
            </Button>
          </div>
          {linkError && <p className="pt-1.5 text-[11px] text-danger">{linkError}</p>}
        </div>
      )}
    </div>
  );
}
