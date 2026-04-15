import MDEditor from '@uiw/react-markdown-preview';
import { rehypeSanitizePlugin } from '../lib/sanitize';

interface MarkdownPreviewProps {
  content: string;
  className?: string;
}

export function MarkdownPreview({ content, className = '' }: MarkdownPreviewProps) {
  if (!content.trim()) {
    return (
      <div className={`text-gray-500 text-sm italic ${className}`}>
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
        color: '#d1d5db',
      }}
      wrapperElement={{
        'data-color-mode': 'dark'
      }}
    />
  );
}
