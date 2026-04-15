// Helper to generate slug from title
export function generateSlug(title: string | null | undefined): string {
    const normalizedTitle = (title || '').trim() || 'Untitled';

    return normalizedTitle
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}
