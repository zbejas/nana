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
  if (original && String(original.get("assignee") || "") === String(e.record.get("assignee") || "")) {
    return e.next()
  }
  const h = require(`${__hooks}/tasks/assignee_helpers.js`)
  h.assertAssignable(e.record, e.auth.id)
  return e.next()
}, "tasks")
