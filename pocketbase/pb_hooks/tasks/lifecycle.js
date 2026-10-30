/// <reference path="../../pb_data/types.d.ts" />

// Task lifecycle: board-scoped numbering and completed_at.
//
// `completed_at` is derived from the column's `is_final` flag, not from a
// hard-coded status name. A shared board can rename a column or add a second
// final column without breaking completion counts.

onRecordCreateRequest((e) => {
  if (!e.auth || e.hasSuperuserAuth()) return e.next()
  const h = require(`${__hooks}/tasks/lifecycle_helpers.js`)
  h.assignNumber(e.record)
  h.syncCompletion(e.record)
  return e.next()
}, "tasks")

onRecordUpdateRequest((e) => {
  if (!e.auth || e.hasSuperuserAuth()) return e.next()
  const original = e.record.original()
  if (original && String(original.get("board") || "") !== String(e.record.get("board") || "")) {
    // Tasks never move between boards; the relation guard rejects this too.
    throw new BadRequestError("A task cannot move to another board.")
  }
  const h = require(`${__hooks}/tasks/lifecycle_helpers.js`)
  h.syncCompletion(e.record)
  return e.next()
}, "tasks")
