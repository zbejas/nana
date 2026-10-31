/// <reference path="../../pb_data/types.d.ts" />

onRecordCreateRequest((e) => {
  if (e.hasSuperuserAuth()) return e.next()
  const h = require(`${__hooks}/documents/revision_helpers.js`)
  let info = null
  try {
    info = e.requestInfo()
  } catch (_) {
    info = null
  }
  h.initializeDocument(e.record, e.auth, info)
  return e.next()
}, "documents")

onRecordUpdateRequest((e) => {
  if (e.hasSuperuserAuth()) return e.next()
  const h = require(`${__hooks}/documents/revision_helpers.js`)
  let info = null
  try {
    info = e.requestInfo()
  } catch (_) {
    info = null
  }
  h.syncDocumentEdit(e.record, e.record.original(), e.auth, info)
  return e.next()
}, "documents")
