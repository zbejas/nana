import { useEffect, useRef, useState } from 'react';
import { editorViewCtx, type Editor } from '@milkdown/kit/core';
import type { EditorView } from '@milkdown/kit/prose/view';
import { cn } from '../../ui';
import { NanaEditorToolbar } from './NanaEditorToolbar';
import { NanaSlashMenu } from './NanaSlashMenu';
import { useMilkdownEditor } from './useMilkdownEditor';
import type { AiChangedSection } from './aiEdits';
import type { EditorActionId } from './helpers';
import type { SlashTriggerPosition } from './createEditor';

export interface NanaMarkdownEditorProps {
  value: string;
  onChange?: (markdown: string) => void;
  readOnly?: boolean;
  placeholder?: string;
  ariaLabel?: string;
  minHeight?: number | string;
  className?: string;
  compact?: boolean;
  showToolbar?: boolean;
  toolbarOnlyOnFocus?: boolean;
  enableSlash?: boolean;
  uploadImage?: (file: File) => Promise<string>;
  aiEdit?: {
    id: string;
    previousMarkdown: string;
    markdown: string;
    sections: AiChangedSection[];
  } | null;
  onFocusChange?: (focused: boolean) => void;
  onViewReady?: (view: EditorView) => void;
  onEditorReady?: (editor: Editor) => void;
}

/**
 * The WYSIWYG Markdown surface. Milkdown owns the ProseMirror document; React
 * owns the toolbar and slash menu. Storage stays Markdown through `onChange`.
 */
export function NanaMarkdownEditor({
  value,
  onChange,
  readOnly = false,
  placeholder = 'Start writing…',
  ariaLabel = 'Document content',
  minHeight,
  className,
  compact = false,
  showToolbar = true,
  toolbarOnlyOnFocus = false,
  enableSlash = true,
  uploadImage,
  aiEdit = null,
  onFocusChange,
  onViewReady,
  onEditorReady,
}: NanaMarkdownEditorProps) {
  const [slashPosition, setSlashPosition] = useState<SlashTriggerPosition | null>(null);
  const linkSelectionRef = useRef<{ from: number; to: number } | null>(null);
  const editor = useMilkdownEditor({
    value,
    onChange,
    readOnly,
    placeholder: readOnly ? '' : placeholder,
    ariaLabel,
    enableSlash: enableSlash && !readOnly,
    uploadImage,
    aiEdit,
    onFocusChange,
    onSlash: (position) => setSlashPosition(position),
    onReady: (instance) => {
      onEditorReady?.(instance);
      onViewReady?.(instance.action((ctx) => ctx.get(editorViewCtx)));
    },
  });

  useEffect(() => {
    if (readOnly) setSlashPosition(null);
  }, [readOnly]);

  const runAction = (action: EditorActionId) => {
    editor.run(action);
    editor.focus();
  };

  const showToolbarNow = !readOnly && showToolbar && (!toolbarOnlyOnFocus || editor.focused);
  const style = minHeight === undefined ? undefined : { minHeight: typeof minHeight === 'number' ? `${minHeight}px` : minHeight };

  return (
    <div
      className={cn(
        'nana-milkdown flex min-h-0 flex-col',
        compact && 'nana-milkdown--compact',
        readOnly && 'nana-milkdown--readonly',
        className,
      )}
      style={style}
    >
      {showToolbarNow && (
        <NanaEditorToolbar
          toolbar={editor.toolbar}
          onAction={runAction}
          onLinkStart={() => {
            linkSelectionRef.current = editor.getSelection();
          }}
          onLinkCancel={() => editor.focus()}
          onLink={(href) => {
            const selection = linkSelectionRef.current;
            if (selection) editor.setSelection(selection.from, selection.to);
            editor.applyHref(href);
            editor.focus();
          }}
          compact={compact}
        />
      )}

      <div
        ref={editor.containerRef}
        className="nana-milkdown-surface relative min-h-0 flex-1"
        aria-busy={!editor.ready || undefined}
      />

      <NanaSlashMenu
        open={Boolean(slashPosition) && !readOnly}
        position={slashPosition ? { left: slashPosition.left, top: slashPosition.top } : null}
        onSelect={(action) => {
          setSlashPosition(null);
          runAction(action);
        }}
        onClose={() => {
          setSlashPosition(null);
          editor.focus();
        }}
      />
    </div>
  );
}
