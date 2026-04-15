import type { ReactNode } from 'react';

export function highlightText(text: string | null | undefined, query: string, highlightClassName = 'bg-blue-500/30 text-blue-200'): ReactNode {
    const sourceText = text || 'Untitled';
    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
        return sourceText;
    }

    const escapedQuery = trimmedQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const parts = sourceText.split(new RegExp(`(${escapedQuery})`, 'gi'));

    return parts.map((part, index) => (
        part.toLowerCase() === trimmedQuery.toLowerCase()
            ? <span key={index} className={highlightClassName}>{part}</span>
            : part
    ));
}
