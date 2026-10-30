/// <reference path="../../pb_data/types.d.ts" />

function appOrGlobal(app) {
  return app || $app
}

function finalStatuses(boardId, app) {
  const result = {}
  try {
    const columns = appOrGlobal(app).findRecordsByFilter(
      "board_columns",
      "board = {:board} && is_final = true",
      "",
      0,
      0,
      { board: boardId }
    )
    for (let i = 0; i < columns.length; i++) {
      result[String(columns[i].get("slug") || "")] = true
    }
  } catch (_) {
    // Migration has not created the collection yet; fall back to the legacy
    // status so task writes keep working during an upgrade window.
    result.done = true
  }
  return result
}

function syncCompletion(record, app) {
  const boardId = String(record.get("board") || "")
  const status = String(record.get("status") || "")
  if (!boardId) return
  const finals = finalStatuses(boardId, app)
  const complete = Boolean(finals[status])
  const current = String(record.get("completed_at") || "")

  if (complete && !current) {
    record.set("completed_at", new Date().toISOString())
  } else if (!complete && current) {
    record.set("completed_at", "")
  }
}

/**
 * Allocate the next per-board number with a single atomic SQL statement. A
 * read-then-write counter loses updates under concurrent creates; SQLite
 * serializes the UPDATE and `RETURNING` hands back the exact value this caller
 * reserved. The loop skips numbers that a legacy/imported task already holds.
 */
function assignNumber(record, app) {
  if (Number(record.get("task_number") || 0) > 0) return

  const boardId = String(record.get("board") || "")
  if (!boardId) return

  const db = appOrGlobal(app)
  for (let attempt = 0; attempt < 50; attempt++) {
    const counter = new DynamicModel({ value: 0 })
    try {
      db.db()
        .newQuery(
          "UPDATE boards SET task_counter = COALESCE(task_counter, 0) + 1 WHERE id = {:id} RETURNING task_counter AS value"
        )
        .bind({ id: boardId })
        .one(counter)
    } catch (err) {
      throw new BadRequestError("A task requires an existing board.")
    }

    const next = Number(counter.value || 0)
    if (!Number.isFinite(next) || next <= 0) {
      throw new BadRequestError("Could not allocate a task number.")
    }

    const clash = db.findRecordsByFilter(
      "tasks",
      "board = {:board} && task_number = {:number}",
      "",
      1,
      0,
      { board: boardId, number: next }
    )
    if (clash.length === 0) {
      record.set("task_number", next)
      return
    }
  }

  throw new BadRequestError("Could not allocate a task number.")
}

module.exports = {
  finalStatuses,
  syncCompletion,
  assignNumber,
}
