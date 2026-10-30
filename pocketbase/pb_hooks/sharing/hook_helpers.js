/// <reference path="../../pb_data/types.d.ts" />

// Small helpers used by sharing lifecycle hooks. Callbacks must require this
// module inside the callback: PocketBase drops module-scope bindings between
// hook invocations.
//
// Rebuilds are strict by default. A privacy, folder, or trash transition that
// cannot recompute access must fail before the new state is exposed; the
// request hooks below run the save and the rebuild in one transaction so a
// failed rebuild rolls the record write back. Trash routes cannot use request
// hooks (they save through `$app`), so they pre-clear grants and record a
// durable repair flag if the post-save rebuild still fails.

function sameValue(left, right) {
  if (left === right) return true
  if (left === null || left === undefined || right === null || right === undefined) {
    return String(left || "") === String(right || "")
  }
  if (typeof left === "object" || typeof right === "object") {
    try {
      return JSON.stringify(left) === JSON.stringify(right)
    } catch (_) {
      return String(left) === String(right)
    }
  }
  return String(left) === String(right)
}

function changed(record, field) {
  if (!record) return false
  const original = record.original()
  if (!original || !original.id) return true
  return !sameValue(record.get(field) || "", original.get(field) || "")
}

function boolChanged(record, field) {
  if (!record) return false
  const original = record.original()
  if (!original || !original.id) return true
  return record.getBool(field) !== original.getBool(field)
}

function sharingFieldsChanged(record, fields) {
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i]
    if (field === "is_private") {
      if (boolChanged(record, field)) return true
      continue
    }
    if (changed(record, field)) return true
  }
  return false
}

/**
 * Run the rest of the request and a sharing rebuild in one transaction. If
 * either the save or the rebuild fails, the record write is rolled back and
 * the caller sees the error.
 */
function runWithRebuild(e, rebuild) {
  const previous = e.app
  $app.runInTransaction((txApp) => {
    e.app = txApp
    try {
      e.next()
      rebuild(txApp)
    } finally {
      e.app = previous
    }
  })
}

/** Recompute one record's effective grants. Throws on failure. */
function syncTarget(targetType, targetId, app) {
  if (!targetId) return
  const access = require(`${__hooks}/sharing/access_helpers.js`)
  access.syncResourceSharing(targetType, targetId, app || $app)
}

/** Recompute a folder subtree's effective grants. Throws on failure. */
function syncFolder(folderId, app) {
  if (!folderId) return
  const access = require(`${__hooks}/sharing/access_helpers.js`)
  access.syncFolderSubtree(folderId, app || $app)
}

/** Revoke existing grants before a privacy/folder/trash transition lands. */
function revokeTarget(targetType, targetId, app) {
  if (!targetId) return
  const access = require(`${__hooks}/sharing/access_helpers.js`)
  access.clearResourceGrants(targetType, targetId, app || $app)
}

function revokeFolder(folderId, app) {
  if (!folderId) return
  const access = require(`${__hooks}/sharing/access_helpers.js`)
  access.clearFolderSubtreeGrants(folderId, app || $app)
}

module.exports = {
  changed,
  boolChanged,
  sharingFieldsChanged,
  runWithRebuild,
  syncTarget,
  syncFolder,
  revokeTarget,
  revokeFolder,
}
