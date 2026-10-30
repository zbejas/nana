/// <reference path="../../pb_data/types.d.ts" />

// Request guards for shared records. The collection rules from migration 0023
// let any reader reach an update/delete; these guards narrow writes to the
// caller's effective permission and reject owner-only fields.
//
// Request hooks must call e.next() when they allow the write to continue.

onRecordUpdateRequest((e) => {
  if (!e.auth || e.hasSuperuserAuth()) return e.next()
  const h = require(`${__hooks}/sharing/permission_helpers.js`)
  h.checkDocumentUpdate(e.record, e.auth.id)
  return e.next()
}, "documents")

onRecordUpdateRequest((e) => {
  if (!e.auth || e.hasSuperuserAuth()) return e.next()
  const h = require(`${__hooks}/sharing/permission_helpers.js`)
  h.checkFolderUpdate(e.record, e.auth.id)
  return e.next()
}, "folders")

onRecordUpdateRequest((e) => {
  if (!e.auth || e.hasSuperuserAuth()) return e.next()
  const h = require(`${__hooks}/sharing/permission_helpers.js`)
  h.checkBoardUpdate(e.record, e.auth.id)
  return e.next()
}, "boards")

onRecordCreateRequest((e) => {
  if (!e.auth || e.hasSuperuserAuth()) return e.next()
  const h = require(`${__hooks}/sharing/permission_helpers.js`)
  let submitted = {}
  try {
    const info = e.requestInfo()
    submitted = (info && info.body) || {}
    if (typeof submitted === "string") submitted = JSON.parse(submitted)
  } catch (_) {
    submitted = {}
  }
  h.checkTaskCreate(e.record, e.auth.id, submitted)
  return e.next()
}, "tasks")

onRecordUpdateRequest((e) => {
  if (!e.auth || e.hasSuperuserAuth()) return e.next()
  const h = require(`${__hooks}/sharing/permission_helpers.js`)
  h.checkTaskUpdate(e.record, e.auth.id)
  return e.next()
}, "tasks")

onRecordDeleteRequest((e) => {
  if (!e.auth || e.hasSuperuserAuth()) return e.next()
  const h = require(`${__hooks}/sharing/permission_helpers.js`)
  h.checkTaskDelete(e.record, e.auth.id)
  return e.next()
}, "tasks")
