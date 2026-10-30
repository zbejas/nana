/// <reference path="../../pb_data/types.d.ts" />

// Append a task activity row for every user-visible mutation. Hooks resolve
// their helper inside the callback because PocketBase does not keep module
// bindings alive across hook invocations.

onRecordAfterCreateSuccess((e) => {
  const h = require(`${__hooks}/tasks/activity_helpers.js`)
  const boardId = String(e.record.get("board") || "")
  if (!boardId) return
  try {
    h.recordActivity(
      e.record.id,
      boardId,
      e.auth ? e.auth.id : "",
      "created",
      { title: String(e.record.get("title") || "") }
    )
  } catch (err) {
    console.error("Failed to record task creation:", err)
  }
}, "tasks")

onRecordAfterUpdateSuccess((e) => {
  const original = e.record.original()
  if (!original || !original.id) return

  const h = require(`${__hooks}/tasks/activity_helpers.js`)
  const boardId = String(e.record.get("board") || "")
  if (!boardId) return

  let changes = []
  try {
    changes = h.diffTask(e.record, original)
  } catch (err) {
    console.error("Failed to diff task update:", err)
    return
  }

  for (let i = 0; i < changes.length; i++) {
    try {
      h.recordActivity(
        e.record.id,
        boardId,
        e.auth ? e.auth.id : "",
        changes[i].type,
        changes[i].data
      )
    } catch (err) {
      console.error("Failed to record task activity:", err)
    }
  }
}, "tasks")
