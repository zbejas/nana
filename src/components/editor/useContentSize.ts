import { useEffect, useState } from 'react';

const CONTENT_SIZE_DEBOUNCE_MS = 400;

/**
 * Content size in UTF-8 bytes. PocketBase's editor limit is measured in bytes,
 * but counting bytes on every keystroke is unnecessary; debounce it so typing
 * in large documents stays responsive.
 */
export function useContentSizeBytes(content: string): number {
  const [bytes, setBytes] = useState(0);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setBytes(new TextEncoder().encode(content).length);
    }, CONTENT_SIZE_DEBOUNCE_MS);

    return () => window.clearTimeout(timeoutId);
  }, [content]);

  return bytes;
}
