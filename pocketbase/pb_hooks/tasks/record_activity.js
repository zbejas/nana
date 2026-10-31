/// <reference path="../../pb_data/types.d.ts" />

// Append a task activity row for every user-visible mutation.
//
// Record after-success events do not carry the request auth (`e.auth` is empty
// there), so activity is written from the request hook after `e.next()` while
// the actor is still known. The save and the activity rows share a transaction;
// the actor is resolved from the request hook and the `X-Nana-Actor: ai` header
// keeps AI writes labelled as Nana.

onRecordCreateRequest((e) => {
  if (!e.auth) return e.next()

  const h = require(`${__hooks}/tasks/activity_helpers.js`)
  let info = null
  try {
    info = e.requestInfo()
  } catch (_) {
    info = null
  }
  const actor = h.actorInfo(e.auth, info, e.hasSuperuserAuth())
  const boardId = String(e.record.get("board") || "")

  const previous = e.app
  $app.runInTransaction((txApp) => {
    e.app = txApp
    try {
      e.next()
      const savedBoard = String(e.record.get("board") || boardId)
      if (!savedBoard) return
      try {
        h.recordActivity(
          e.record.id,
          savedBoard,
          actor,
          "created",
          { title: String(e.record.get("title") || "") },
          txApp
        )
      } catch (err) {
        console.error("Failed to record task creation:", err)
      }
    } finally {
      e.app = previous
    }
  })
}, "tasks")

onRecordUpdateRequest((e) => {
  if (!e.auth) return e.next()

  const h = require(`${__hooks}/tasks/activity_helpers.js`)
  const original = e.record.original()
  if (!original || !original.id) return e.next()

  let info = null
  try {
    info = e.requestInfo()
  } catch (_) {
    info = null
  }
  const actor = h.actorInfo(e.auth, info, e.hasSuperuserAuth())

  const previous = e.app
  $app.runInTransaction((txApp) => {
    e.app = txApp
    try {
      e.next()

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
            actor,
            changes[i].type,
            changes[i].data,
            txApp
          )
        } catch (err) {
          console.error("Failed to record task activity:", err)
        }
      }
    } finally {
      e.app = previous
    }
  })
}, "tasks")
