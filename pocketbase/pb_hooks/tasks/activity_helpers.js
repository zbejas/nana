/// <reference path="../../pb_data/types.d.ts" />

// Task activity is an append-only audit trail. Hooks run with the request
// actor when there is one; internal writes (migrations, imports) leave actor
// empty so the UI can label them as system events.

function text(record, field) {
  const value = record.get(field)
  if (value === null || value === undefined) return ""
  return String(value)
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function diffTask(record, original) {
  if (!original || !original.id) return []

  const changes = []
  const fields = ["title", "status", "priority", "due_date", "start_date", "assignee", "document"]
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i]
    const from = text(original, field)
    const to = text(record, field)
    if (from === to) continue
    changes.push({ type: field + "_changed", data: { from: from, to: to } })
  }

  const labelsFrom = original.get("labels")
  const labelsTo = record.get("labels")
  if (!same(labelsFrom, labelsTo)) {
    changes.push({ type: "labels_changed", data: { from: labelsFrom, to: labelsTo } })
  }

  const descriptionFrom = text(original, "description")
  const descriptionTo = text(record, "description")
  if (descriptionFrom !== descriptionTo) {
    changes.push({ type: "description_changed", data: { length: descriptionTo.length } })
  }

  const recurrenceFrom = original.get("recurrence")
  const recurrenceTo = record.get("recurrence")
  if (!same(recurrenceFrom, recurrenceTo)) {
    changes.push({ type: "recurrence_changed", data: { from: recurrenceFrom, to: recurrenceTo } })
  }

  return changes
}

function recordActivity(taskId, boardId, actorId, type, data) {
  const collection = $app.findCollectionByNameOrId("task_activity")
  const activity = new Record(collection)
  activity.set("task", taskId)
  activity.set("board", boardId)
  if (actorId) activity.set("actor", actorId)
  activity.set("type", type)
  activity.set("data", data || {})
  $app.save(activity)
}

module.exports = {
  diffTask: diffTask,
  recordActivity: recordActivity,
}
