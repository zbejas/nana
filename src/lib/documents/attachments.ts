import { pb } from '../pocketbase';
import type { Document } from './types';

const FILE_TOKEN_STORAGE_KEY = 'nana-file-token';

let fileTokenCache: string | null = null;
let fileTokenRefreshPromise: Promise<string> | null = null;

function decodeJwtPayload(token: string): { exp?: number } | null {
    try {
        const parts = token.split('.');
        if (parts.length < 2 || !parts[1]) {
            return null;
        }

        const payload = parts[1]
            .replace(/-/g, '+')
            .replace(/_/g, '/');

        const padded = payload + '='.repeat((4 - (payload.length % 4)) % 4);
        const decoded = typeof atob === 'function'
            ? atob(padded)
            : Buffer.from(padded, 'base64').toString('utf-8');

        return JSON.parse(decoded) as { exp?: number };
    } catch {
        return null;
    }
}

function isFileTokenValid(token: string | null): boolean {
    if (!token) {
        return false;
    }

    const payload = decodeJwtPayload(token);
    if (!payload?.exp) {
        return false;
    }

    const now = Math.floor(Date.now() / 1000);
    return payload.exp > now + 30;
}

function loadFileTokenFromStorage(): string | null {
    if (typeof window === 'undefined') {
        return null;
    }

    try {
        const stored = window.localStorage.getItem(FILE_TOKEN_STORAGE_KEY);
        return stored && isFileTokenValid(stored) ? stored : null;
    } catch {
        return null;
    }
}

function saveFileTokenToStorage(token: string | null) {
    if (typeof window === 'undefined') {
        return;
    }

    try {
        if (token) {
            window.localStorage.setItem(FILE_TOKEN_STORAGE_KEY, token);
        } else {
            window.localStorage.removeItem(FILE_TOKEN_STORAGE_KEY);
        }
    } catch {
        // no-op
    }
}

function getCachedFileToken(): string | null {
    if (isFileTokenValid(fileTokenCache)) {
        return fileTokenCache;
    }

    const stored = loadFileTokenFromStorage();
    if (stored) {
        fileTokenCache = stored;
        return stored;
    }

    fileTokenCache = null;
    return null;
}

function setFileToken(url: string, token: string): string {
    if (!token) {
        return url;
    }

    try {
        const parsed = new URL(url, typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
        parsed.searchParams.set('token', token);

        // Preserve relative URLs when input is relative.
        if (!url.startsWith('http')) {
            return `${parsed.pathname}${parsed.search}${parsed.hash}`;
        }

        return parsed.toString();
    } catch {
        const separator = url.includes('?') ? '&' : '?';
        return `${url}${separator}token=${encodeURIComponent(token)}`;
    }
}

export async function ensureAttachmentFileToken(forceRefresh: boolean = false): Promise<string> {
    if (!forceRefresh) {
        const cached = getCachedFileToken();
        if (cached) {
            return cached;
        }
    }

    if (fileTokenRefreshPromise) {
        return fileTokenRefreshPromise;
    }

    fileTokenRefreshPromise = pb.files.getToken()
        .then((token) => {
            fileTokenCache = token;
            saveFileTokenToStorage(token);
            return token;
        })
        .finally(() => {
            fileTokenRefreshPromise = null;
        });

    return fileTokenRefreshPromise;
}

// Get attachment URL for a document
export function getAttachmentUrl(document: Document, filename: string, thumb?: string): string {
    // Use PocketBase's getURL method which handles token and formatting correctly
    // Then ensure it uses our proxy by checking if it's absolute
    const url = pb.files.getURL(document, filename, { thumb });

    // If URL is relative, it's already correct (will use /pb base)
    // If URL is absolute, replace the base with our proxy
    const token = getCachedFileToken();

    if (url.startsWith('http')) {
        const urlObj = new URL(url);
        const proxied = urlObj.pathname + urlObj.search;

        if (!token && pb.authStore.isValid) {
            void ensureAttachmentFileToken();
        }

        return token ? setFileToken(proxied, token) : proxied;
    }

    if (!token && pb.authStore.isValid) {
        void ensureAttachmentFileToken();
    }

    return token ? setFileToken(url, token) : url;
}

export async function getAttachmentUrlWithFreshToken(url: string): Promise<string> {
    const freshToken = await ensureAttachmentFileToken(true);
    return setFileToken(url, freshToken);
}

// Extract original filename by removing PocketBase's random suffix
// PocketBase adds random characters before the extension (e.g., file_abc123.pdf)
export function getOriginalFilename(filename: string): string {
    // Match pattern: name_randomchars.extension
    const match = filename.match(/^(.+?)_[a-zA-Z0-9]+(\.[^.]+)$/);
    if (match && match[1] && match[2]) {
        return match[1] + match[2]; // Return name + extension without random part
    }
    return filename; // Return as-is if pattern doesn't match
}

// Check if a file is a PDF
export function isPdfFile(filename: string): boolean {
    return /\.pdf$/i.test(filename);
}

// Check if a file is a viewable image
export function isImageFile(filename: string): boolean {
    return /\.(jpg|jpeg|png|gif|webp|svg|bmp|ico)$/i.test(filename);
}

// Check if a file can be opened in the in-app viewer (extensible for future types)
export function isViewableFile(filename: string): boolean {
    return isPdfFile(filename) || isImageFile(filename);
}

// Get all attachment URLs for a document
export function getAttachmentUrls(document: Document): { filename: string; displayName: string; url: string; thumbUrl: string }[] {
    if (!document.attachments || document.attachments.length === 0) {
        return [];
    }

    return document.attachments.map(filename => ({
        filename,
        displayName: getOriginalFilename(filename),
        url: getAttachmentUrl(document, filename),
        thumbUrl: getAttachmentUrl(document, filename, '300x0'),
    }));
}
