/**
 * Pure editor adoption rules for document transitions.
 *
 * A document switch replaces the editor fields with the selected record. The
 * first save of a new note is different: the URL changes from `/document/new`
 * to `/document/:id`, but the editor fields are the same local draft, possibly
 * with title/body/tags typed while the create request was in flight. Those
 * values must survive the promotion so the live room or the metadata autosave
 * can persist them.
 */

import { normalizeCollabMarkdown } from "../collaboration/normalize";
import type { Document } from "./types";

export interface EditorDraftSnapshot {
    title: string;
    content: string;
    tags: string[];
}

export interface EditorDocumentAdoption extends EditorDraftSnapshot {
    /** The kept body still differs from the saved record and needs a write. */
    contentDirty: boolean;
    /** At least one field came from the local draft instead of the record. */
    preservedDraft: boolean;
}

/**
 * `blank` starts a new note, `promotion` is the first save of that same new
 * note, and `document` is a normal existing-note switch/load.
 */
export type DocumentAdoptionMode = "blank" | "promotion" | "document";

export interface AdoptEditorDocumentInput {
    mode: DocumentAdoptionMode;
    /** Record selected after the transition; null for a blank new note. */
    document: Document | null;
    /** Values currently in the editor. */
    current: EditorDraftSnapshot;
    initialTitle?: string;
    initialContent?: string;
}

function sameTags(left: readonly string[], right: readonly string[]): boolean {
    if (left.length !== right.length) return false;
    return left.every((tag, index) => tag === right[index]);
}

function savedTitleOf(document: Document): string {
    return document.title || "Untitled";
}

function sameTitle(current: string, document: Document): boolean {
    return (current.trim() || "Untitled") === savedTitleOf(document);
}

/**
 * Resolve the editor fields after a transition.
 *
 * Normal document adoption always trusts the selected record, so state from
 * note A can never flow into note B. Promotion keeps local content when it
 * differs from the just-saved body and keeps a changed title or tag list; an
 * untouched new note adopts the saved record so its normalized title and
 * server-side metadata appear in the editor.
 */
export function adoptEditorDocument({
    mode,
    document,
    current,
    initialTitle = "",
    initialContent = "",
}: AdoptEditorDocumentInput): EditorDocumentAdoption {
    if (mode === "blank" || !document) {
        return {
            title: initialTitle,
            content: initialContent,
            tags: [],
            contentDirty: false,
            preservedDraft: false,
        };
    }

    if (mode === "document") {
        return {
            title: document.title || "",
            content: normalizeCollabMarkdown(document.content),
            tags: [...(document.tags || [])],
            contentDirty: false,
            preservedDraft: false,
        };
    }

    const savedContent = normalizeCollabMarkdown(document.content);
    const contentDiffers = normalizeCollabMarkdown(current.content) !== savedContent;
    const titleDiffers = !sameTitle(current.title, document);
    const tagsDiffer = !sameTags(current.tags, document.tags || []);

    return {
        // Preserve the exact local body when it has typed-during-save text.
        content: contentDiffers ? current.content : savedContent,
        // A blank title on a note saved as "Untitled" is not a typed change.
        title: titleDiffers ? current.title : document.title || "",
        tags: tagsDiffer ? [...current.tags] : [...(document.tags || [])],
        contentDirty: contentDiffers,
        preservedDraft: contentDiffers || titleDiffers || tagsDiffer,
    };
}
