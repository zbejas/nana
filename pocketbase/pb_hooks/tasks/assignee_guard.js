/// <reference path="../../pb_data/types.d.ts" />

onRecordCreateRequest((e) => {
  if (!e.auth || e.hasSuperuserAuth()) return e.next()
  const h = require(`${__hooks}/tasks/assignee_helpers.js`)
  h.assertAssignable(e.record, e.auth.id)
  return e.next()
}, "tasks")

onRecordUpdateRequest((e) => {
  if (!e.auth || e.hasSuperuserAuth()) return e.next()
  const original = e.record.original()
  // Revalidate when the assignee or the board changes. Task board moves are
  // rejected elsewhere, but this guard stays self-contained.
  if (
    original &&
    String(original.get("assignee") || "") === String(e.record.get("assignee") || "") &&
    String(original.get("board") || "") === String(e.record.get("board") || "")
  ) {
    return e.next()
  }
  const h = require(`${__hooks}/tasks/assignee_helpers.js`)
  h.assertAssignable(e.record, e.auth.id)
  return e.next()
}, "tasks")
