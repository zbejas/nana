import MDEditor from '@uiw/react-markdown-preview';
import { rehypeSanitizePlugin } from '../lib/sanitize';
import { useTheme } from '../lib/theme';

interface MarkdownPreviewProps {
  content: string;
  className?: string;
}

export function MarkdownPreview({ content, className = '' }: MarkdownPreviewProps) {
  const { resolved } = useTheme();

  if (!content.trim()) {
    return (
      <div className={`text-sm italic text-ink-muted ${className}`}>
        No content to preview
      </div>
    );
  }

  const previewTagFallbacks = {
    iso: ({ children }: any) => <span>{children}</span>,
    docname: ({ children }: any) => <span>{children}</span>,
  } as any;

  return (
    <MDEditor
      source={content}
      skipHtml={true}
      rehypePlugins={[rehypeSanitizePlugin]}
      components={previewTagFallbacks}
      className={className}
      style={{
        backgroundColor: 'transparent',
        color: 'var(--ink-secondary)',
      }}
      wrapperElement={{
        'data-color-mode': resolved,
      }}
    />
  );
}
