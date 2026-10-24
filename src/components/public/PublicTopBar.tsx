import type { ReactNode } from 'react';

interface PublicTopBarProps {
    subtitle?: string;
    author?: string;
    title: string;
    rightContent?: ReactNode;
    logo?: string;
}

export function PublicTopBar({ subtitle, author, title, rightContent, logo }: PublicTopBarProps) {
    return (
        <header className="sticky top-0 z-20 border-b border-line bg-canvas-deep/90 backdrop-blur-xl">
            <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-3 sm:px-6">
                <div className="flex items-center gap-4">
                    <div className="flex min-w-0 items-center gap-2.5">
                        {logo && <img src={logo} alt="Nana" className="h-7 w-7 shrink-0" />}
                        <div className="min-w-0">
                            <p className="truncate text-[12px] font-medium leading-tight text-ink">
                                {subtitle || 'Nana'}
                            </p>
                            <p className="truncate text-[11px] leading-tight text-ink-muted">
                                {author ? `Shared by ${author}` : 'Shared note'}
                            </p>
                        </div>
                    </div>

                    <h1 className="hidden min-w-0 flex-1 truncate text-center font-display text-base text-ink sm:block">
                        {title || 'Untitled'}
                    </h1>

                    <div className="ml-auto flex shrink-0 items-center gap-3">{rightContent}</div>
                </div>

                <h1 className="truncate font-display text-lg text-ink sm:hidden">{title || 'Untitled'}</h1>
            </div>
        </header>
    );
}
