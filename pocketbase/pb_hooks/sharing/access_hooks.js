/// <reference path="../../pb_data/types.d.ts" />

// Keep inherited folder grants in sync when records are created or moved.
// Direct shares are handled transactionally by the share routes.

function changed(record, field) {
  const original = record.original()
  if (!original || !original.id) return true
  return String(record.get(field) || "") !== String(original.get(field) || "")
}

function boolChanged(record, field) {
  const original = record.original()
  if (!original || !original.id) return true
  return record.getBool(field) !== original.getBool(field)
}

function safelyRebuild(fn) {
  try {
    fn()
  } catch (err) {
    console.error("Failed to rebuild share access:", err)
  }
}

onRecordAfterCreateSuccess((e) => {
  const h = require(`${__hooks}/sharing/access_helpers.js`)
  safelyRebuild(() => h.rebuildResourceGrants("document", e.record.id))
}, "documents")

onRecordAfterUpdateSuccess((e) => {
  if (!changed(e.record, "folder") && !boolChanged(e.record, "is_private")) {
    return
  }
  const h = require(`${__hooks}/sharing/access_helpers.js`)
  safelyRebuild(() => h.rebuildResourceGrants("document", e.record.id))
}, "documents")

onRecordAfterCreateSuccess((e) => {
  const h = require(`${__hooks}/sharing/access_helpers.js`)
  safelyRebuild(() => h.rebuildResourceGrants("board", e.record.id))
}, "boards")

onRecordAfterUpdateSuccess((e) => {
  if (!changed(e.record, "folder") && !boolChanged(e.record, "is_private")) {
    return
  }
  const h = require(`${__hooks}/sharing/access_helpers.js`)
  safelyRebuild(() => h.rebuildResourceGrants("board", e.record.id))
}, "boards")

onRecordAfterCreateSuccess((e) => {
  const h = require(`${__hooks}/sharing/access_helpers.js`)
  safelyRebuild(() => h.rebuildResourceGrants("folder", e.record.id))
}, "folders")

onRecordAfterUpdateSuccess((e) => {
  if (!changed(e.record, "parent") && !boolChanged(e.record, "is_private")) {
    return
  }
  const h = require(`${__hooks}/sharing/access_helpers.js`)
  safelyRebuild(() => h.rebuildFolderSubtree(e.record.id))
}, "folders")
