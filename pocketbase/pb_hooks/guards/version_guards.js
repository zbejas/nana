/// <reference path="../../pb_data/types.d.ts" />

// Guard: prevent direct manipulation of document versions via the API.
// Versions are managed internally by hooks (create_version.js) and trash routes.
// Internal operations ($app.save / $app.delete) bypass these hooks.
onRecordCreateRequest((e) => {
  if (e.hasSuperuserAuth()) {
    return e.next();
  }

  throw new BadRequestError("Cannot create document versions directly.");
}, "document_versions");

onRecordUpdateRequest((e) => {
  if (e.hasSuperuserAuth()) {
    return e.next();
  }

  throw new BadRequestError("Document versions cannot be modified.");
}, "document_versions");

onRecordDeleteRequest((e) => {
  if (e.hasSuperuserAuth()) {
    return e.next();
  }

  throw new BadRequestError("Cannot delete document versions directly.");
}, "document_versions");
