/// <reference path="../../pb_data/types.d.ts" />

function finalStatuses(boardId) {
  const result = {}
  try {
    const columns = $app.findRecordsByFilter(
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

function syncCompletion(record) {
  const boardId = String(record.get("board") || "")
  const status = String(record.get("status") || "")
  if (!boardId) return
  const finals = finalStatuses(boardId)
  const complete = Boolean(finals[status])
  const current = String(record.get("completed_at") || "")

  if (complete && !current) {
    record.set("completed_at", new Date().toISOString())
  } else if (!complete && current) {
    record.set("completed_at", "")
  }
}

function assignNumber(record) {
  if (Number(record.get("task_number") || 0) > 0) return

  const boardId = String(record.get("board") || "")
  if (!boardId) return

  let board
  try {
    board = $app.findRecordById("boards", boardId)
  } catch (_) {
    return
  }

  const next = Number(board.get("task_counter") || 0) + 1
  board.set("task_counter", next)
  $app.save(board)
  record.set("task_number", next)
}

module.exports = {
  finalStatuses,
  syncCompletion,
  assignNumber,
}
