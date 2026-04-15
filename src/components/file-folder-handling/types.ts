import type { DragEvent } from 'react';

export type DropPosition = 'above' | 'below' | 'into';

export type OnDragStartDocument = (e: DragEvent, documentId: string, currentFolderId?: string) => void;
export type OnDragStartFolder = (e: DragEvent, folderId: string, parentFolderId?: string) => void;
export type OnDragEnd = () => void;
export type OnDragOver = (e: DragEvent, folderId?: string, position?: DropPosition) => void;
export type OnDragLeave = (e: DragEvent) => void;
export type OnDrop = (e: DragEvent, folderId?: string, targetParentId?: string) => void;
