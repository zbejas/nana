/// <reference path="../../pb_data/types.d.ts" />

// Keep inherited folder grants and direct user shares in sync when records are
// created, moved, made private, trashed, or restored.
//
// Privacy, move, and trash transitions are fail-closed: the request hook
// revokes the old grants, saves the record, and rebuilds access in one
// transaction. If the rebuild fails the whole write rolls back, so a stale
// grant can never outlive the privacy change. Creates and restores under-grant
// on failure (safe) and queue a repair row instead of failing the write.
//
// Every helper is required inside the callback: PocketBase drops module-scope
// bindings in hook files between invocations. Request hooks call e.next().

onRecordCreateRequest((e) => {
  if (!e.auth) return e.next()
  e.next()
  const repair = require(`${__hooks}/sharing/repair_helpers.js`)
  repair.safeSync("document", e.record.id, $app, "create_target")
}, "documents")

onRecordUpdateRequest((e) => {
  if (!e.auth) return e.next()
  const h = require(`${__hooks}/sharing/hook_helpers.js`)
  if (!h.sharingFieldsChanged(e.record, ["folder", "is_private", "deleted_at"])) {
    return e.next()
  }
  h.runWithRebuild(e, (txApp) => {
    h.revokeTarget("document", e.record.id, txApp)
    h.syncTarget("document", e.record.id, txApp)
  })
}, "documents")

onRecordCreateRequest((e) => {
  if (!e.auth) return e.next()
  e.next()
  const repair = require(`${__hooks}/sharing/repair_helpers.js`)
  repair.safeSync("board", e.record.id, $app, "create_target")
}, "boards")

onRecordUpdateRequest((e) => {
  if (!e.auth) return e.next()
  const h = require(`${__hooks}/sharing/hook_helpers.js`)
  if (!h.sharingFieldsChanged(e.record, ["folder", "is_private"])) {
    return e.next()
  }
  h.runWithRebuild(e, (txApp) => {
    h.revokeTarget("board", e.record.id, txApp)
    h.syncTarget("board", e.record.id, txApp)
  })
}, "boards")

onRecordCreateRequest((e) => {
  if (!e.auth) return e.next()
  e.next()
  const repair = require(`${__hooks}/sharing/repair_helpers.js`)
  repair.safeSync("folder", e.record.id, $app, "create_folder")
}, "folders")

onRecordUpdateRequest((e) => {
  if (!e.auth) return e.next()
  const h = require(`${__hooks}/sharing/hook_helpers.js`)
  if (!h.sharingFieldsChanged(e.record, ["parent", "is_private", "deleted_at"])) {
    return e.next()
  }
  h.runWithRebuild(e, (txApp) => {
    h.revokeFolder(e.record.id, txApp)
    h.syncFolder(e.record.id, txApp)
  })
}, "folders")
