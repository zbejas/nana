import MDEditor from '@uiw/react-markdown-preview';
import { rehypeNormalizeAlertClasses, rehypeSanitizePlugin } from '../lib/sanitize';
import { rewriteLegacyFileUrl } from '../lib/legacy-urls';
import { useTheme } from '../lib/theme';

interface MarkdownPreviewProps {
  content: string;
  className?: string;
}

/** Badges are small, wide images; keep them inline instead of card-sized. */
function PreviewImage({ src, alt, onLoad, ...props }: any) {
  return (
    <img
      src={rewriteLegacyFileUrl(src)}
      alt={alt}
      onLoad={(event: any) => {
        const image = event.currentTarget as HTMLImageElement;
        const badge = image.naturalWidth >= 48
          && image.naturalHeight > 0
          && image.naturalHeight <= 28;
        image.classList.toggle('nana-inline-badge', badge);
        onLoad?.(event);
      }}
      {...props}
    />
  );
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
    img: PreviewImage,
    a: ({ href, children, ...props }: any) => <a href={rewriteLegacyFileUrl(href)} {...props}>{children}</a>,
  } as any;

  return (
    <MDEditor
      source={content}
      skipHtml={true}
      rehypePlugins={[rehypeNormalizeAlertClasses, rehypeSanitizePlugin]}
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
