import { cn } from '../../ui';
import { NanaMarkdownEditor } from './NanaMarkdownEditor';

export interface NanaInlineMarkdownEditorProps {
  value: string;
  onChange: (markdown: string) => void;
  placeholder?: string;
  readOnly?: boolean;
  minHeight?: number | string;
  ariaLabel?: string;
  className?: string;
  showToolbar?: boolean;
  enableSlash?: boolean;
}

/**
 * Compact WYSIWYG for task descriptions and comment composers. Same Markdown
 * contract as the document editor, no source pane.
 */
export function NanaInlineMarkdownEditor({
  value,
  onChange,
  placeholder = 'Add a description…',
  readOnly = false,
  minHeight = 88,
  ariaLabel = 'Description',
  className,
  showToolbar = true,
  enableSlash = true,
}: NanaInlineMarkdownEditorProps) {
  return (
    <div
      className={cn(
        'nana-inline-editor overflow-hidden rounded-control border bg-surface-sunken transition-[background-color,border-color,box-shadow] duration-150',
        readOnly
          ? 'border-transparent bg-transparent'
          : 'border-line focus-within:border-signal/60 focus-within:bg-surface focus-within:ring-4 focus-within:ring-signal/10',
        className,
      )}
    >
      <NanaMarkdownEditor
        value={value}
        onChange={onChange}
        readOnly={readOnly}
        placeholder={placeholder}
        ariaLabel={ariaLabel}
        minHeight={minHeight}
        compact
        showToolbar={showToolbar && !readOnly}
        enableSlash={enableSlash && !readOnly}
        className="nana-milkdown--inline"
      />
    </div>
  );
}
