/// <reference path="../../pb_data/types.d.ts" />

// Guard: prevent any modification of trashed items via the API.
// Trashed records are read-only — users must restore them first.
// Internal operations ($app.save / $app.delete) bypass these hooks.
onRecordCreateRequest((e) => {
  if (e.hasSuperuserAuth()) {
    return e.next();
  }

  throw new BadRequestError("Cannot create records directly in trash. Use the trash API routes.");
}, "trash_documents", "trash_folders", "trash_document_versions");

onRecordUpdateRequest((e) => {
  if (e.hasSuperuserAuth()) {
    return e.next();
  }

  throw new BadRequestError("Trashed items cannot be modified. Restore the item first.");
}, "trash_documents", "trash_folders", "trash_document_versions");

onRecordDeleteRequest((e) => {
  if (e.hasSuperuserAuth()) {
    return e.next();
  }

  throw new BadRequestError("Cannot delete trash records directly. Use the trash API routes.");
}, "trash_documents", "trash_folders", "trash_document_versions");
