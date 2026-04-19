import type { ReactNode } from 'react';

interface PublicTopBarProps {
    /** Left section: folder name or other heading */
    subtitle?: string;
    /** Left section: "Shared by ..." */
    author?: string;
    /** Center: active document title */
    title: string;
    /** Right slot: badges, metadata */
    rightContent?: ReactNode;
}

export function PublicTopBar({ subtitle, author, title, rightContent }: PublicTopBarProps) {
    return (
        <header className="sticky top-0 z-20 border-b border-white/15 bg-white/8 backdrop-blur-xl px-4 py-2.5 sm:px-6">
            {/* Mobile: stacked rows. Desktop: single row with left/center/right */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 sm:flex-nowrap">
                {/* Left: folder name + author */}
                {(subtitle || author) && (
                    <div className="flex items-center gap-2 text-xs text-stone-400 shrink-0 max-sm:basis-full max-sm:justify-center">
                        {subtitle && <span className="font-semibold text-stone-300">{subtitle}</span>}
                        {subtitle && author && <span className="text-stone-500">&middot;</span>}
                        {author && <span>Shared by {author}</span>}
                    </div>
                )}

                {/* Center: document title */}
                <div className="flex-1 min-w-0 text-center max-sm:basis-full">
                    <h1 className="truncate text-base font-semibold text-white sm:text-lg">{title || 'Untitled'}</h1>
                </div>

                {/* Right: metadata */}
                {rightContent && (
                    <div className="shrink-0 flex items-center gap-3 max-sm:basis-full max-sm:justify-center">
                        {rightContent}
                    </div>
                )}
            </div>
        </header>
    );
}
