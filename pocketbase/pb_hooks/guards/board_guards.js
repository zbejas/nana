/// <reference path="../../pb_data/types.d.ts" />

// Guard: a board may only be filed into a folder owned by the caller.
// PocketBase evaluates relation rules against the stored record, so the
// incoming `folder` value needs an explicit ownership check.
//
// Clearing a folder (`folder = ""`) is always allowed, and internal saves
// bypass request hooks so trash rehoming and migrations are unaffected.
//
// The check is inlined into each callback on purpose: PocketBase's JSVM does
// not keep module-scope helper bindings alive when it later invokes a hook
// callback. Keep the two blocks in sync.

onRecordCreateRequest((e) => {
  if (!e.auth || e.hasSuperuserAuth()) {
    return e.next();
  }

  const folderId = String(e.record.getString("folder") || "");
  if (folderId) {
    let folder;
    try {
      folder = $app.findRecordById("folders", folderId);
    } catch (_) {
      throw new BadRequestError("Folder not found.");
    }

    if (folder.getString("author") !== e.auth.id) {
      throw new ForbiddenError("You can only file a board into your own folders.");
    }
  }

  return e.next();
}, "boards");

onRecordUpdateRequest((e) => {
  if (!e.auth || e.hasSuperuserAuth()) {
    return e.next();
  }

  const folderId = String(e.record.getString("folder") || "");
  if (folderId) {
    let folder;
    try {
      folder = $app.findRecordById("folders", folderId);
    } catch (_) {
      throw new BadRequestError("Folder not found.");
    }

    if (folder.getString("author") !== e.auth.id) {
      throw new ForbiddenError("You can only file a board into your own folders.");
    }
  }

  return e.next();
}, "boards");
