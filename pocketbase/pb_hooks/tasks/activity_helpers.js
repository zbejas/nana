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

function headerValue(info, name) {
  const headers = (info && info.headers) || {}
  const wanted = String(name || "").toLowerCase()
  for (const key in headers) {
    const normalized = String(key).toLowerCase().replace(/_/g, "-")
    if (normalized !== wanted) continue
    const value = headers[key]
    return Array.isArray(value) ? String(value[0] || "") : String(value || "")
  }
  return ""
}

function actorInfo(auth, info, isSuperuser) {
  if (headerValue(info, "X-Nana-Actor").toLowerCase() === "ai") {
    return { id: "", type: "ai", label: "Nana" }
  }
  if (!auth) return { id: "", type: "system", label: "System" }
  // A superuser record lives in `_superusers`, not `users`; it cannot be an
  // activity actor relation. Imports and admin writes are system events.
  if (isSuperuser) return { id: "", type: "system", label: "System" }
  return {
    id: auth.id,
    type: "user",
    label: String(auth.get("name") || auth.email() || "You").slice(0, 120),
  }
}

function recordActivity(taskId, boardId, actor, type, data, app) {
  const db = app || $app
  const collection = db.findCollectionByNameOrId("task_activity")
  const activity = new Record(collection)
  activity.set("task", taskId)
  activity.set("board", boardId)
  if (actor && actor.id) activity.set("actor", actor.id)
  activity.set("actor_type", (actor && actor.type) || "system")
  activity.set("actor_label", (actor && actor.label) || "System")
  activity.set("type", type)
  activity.set("data", data || {})
  db.save(activity)
}

module.exports = {
  actorInfo,
  diffTask,
  headerValue,
  recordActivity,
}
