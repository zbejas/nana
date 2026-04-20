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
    /** Optional logo image src */
    logo?: string;
}

export function PublicTopBar({ subtitle, author, title, rightContent, logo }: PublicTopBarProps) {
    return (
        <header className="sticky top-0 z-20 border-b border-amber-500/10 bg-stone-900/90 backdrop-blur-xl px-4 py-3 sm:px-6 shadow-[0_1px_12px_0_rgba(217,119,6,0.06)]">
            {/* Mobile: stacked rows */}
            <div className="flex flex-col items-center gap-1 sm:hidden">
                <div className="flex items-center gap-2 text-xs text-stone-400">
                    {logo && <img src={logo} alt="Nana" className="h-5 w-5" />}
                    {subtitle && <span className="font-semibold text-stone-300">{subtitle}</span>}
                    {subtitle && author && <span className="text-stone-500">&middot;</span>}
                    {author && <span>Shared by {author}</span>}
                </div>
                <h1 className="truncate text-base font-semibold text-white max-w-full">{title || 'Untitled'}</h1>
                {rightContent && (
                    <div className="flex items-center gap-3">
                        {rightContent}
                    </div>
                )}
            </div>

            {/* Desktop: absolute-centered title with left/right flanks */}
            <div className="hidden sm:grid sm:grid-cols-[1fr_auto_1fr] sm:items-center sm:gap-4">
                {/* Left: logo + folder name + author */}
                <div className="flex items-center gap-2 text-xs text-stone-400">
                    {logo && <img src={logo} alt="Nana" className="h-5 w-5" />}
                    {subtitle && <span className="font-semibold text-stone-300">{subtitle}</span>}
                    {subtitle && author && <span className="text-stone-500">&middot;</span>}
                    {author && <span>Shared by {author}</span>}
                </div>

                {/* Center: document title — always centered */}
                <h1 className="truncate text-lg font-semibold text-white text-center max-w-md">{title || 'Untitled'}</h1>

                {/* Right: metadata */}
                <div className="flex items-center justify-end gap-3">
                    {rightContent}
                </div>
            </div>
        </header>
    );
}
