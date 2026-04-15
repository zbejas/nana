import JSZip from "jszip";
import { documentToMarkdown, sanitizeFilename } from "./documents";
import type { AttachmentFile, ResolvedDocument } from "./types";

/**
 * Build a ZIP archive from resolved documents and their attachments.
 *
 * ZIP structure:
 *   DocName.md
 *   DocName_attachments/
 *     photo.png
 *     notes.pdf
 *   FolderA/
 *     SubDoc.md
 *     SubDoc_attachments/
 *       diagram.svg
 *
 * Documents without attachments are placed directly with no companion folder.
 */
export async function buildExportZip(
    entries: { resolved: ResolvedDocument; attachments: AttachmentFile[] }[],
): Promise<Uint8Array> {
    const zip = new JSZip();

    // Track used paths to avoid collisions (two docs with the same title in the same folder)
    const usedPaths = new Set<string>();

    for (const { resolved, attachments } of entries) {
        const { doc, folderPath } = resolved;
        const docName = sanitizeFilename(doc.title);

        // Build the markdown file path
        let mdPath = folderPath ? `${folderPath}/${docName}` : docName;

        // Deduplicate paths
        if (usedPaths.has(mdPath)) {
            let counter = 2;
            while (usedPaths.has(`${mdPath}_${counter}`)) counter++;
            mdPath = `${mdPath}_${counter}`;
        }
        usedPaths.add(mdPath);

        // Add the markdown file directly in its folder
        const markdown = documentToMarkdown(doc);
        zip.file(`${mdPath}.md`, markdown);

        // Add attachments in a sibling folder named DocName_attachments/
        if (attachments.length > 0) {
            for (const att of attachments) {
                zip.file(`${mdPath}_attachments/${att.displayName}`, att.data);
            }
        }
    }

    return zip.generateAsync({ type: "uint8array" });
}
