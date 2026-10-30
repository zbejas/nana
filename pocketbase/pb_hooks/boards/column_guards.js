/// <reference path="../../pb_data/types.d.ts" />

// Workflow columns are referenced by `tasks.status` (the stable slug). A
// column cannot be deleted while tasks use it, and its slug cannot change
// after tasks exist, or those tasks would disappear from the board.

onRecordUpdateRequest((e) => {
  if (!e.auth || e.hasSuperuserAuth()) return e.next()
  const original = e.record.original()
  if (!original || !original.id) return e.next()

  const before = String(original.get("slug") || "")
  const after = String(e.record.get("slug") || "")
  if (before === after) return e.next()

  const tasks = $app.findRecordsByFilter(
    "tasks",
    "board = {:board} && status = {:status}",
    "",
    1,
    0,
    { board: String(e.record.get("board") || ""), status: before }
  )
  if (tasks.length > 0) {
    throw new BadRequestError("This column still has tasks. Move them before changing its key.")
  }
  return e.next()
}, "board_columns")

// Moving a column between final and open changes the completion meaning for
// every task already in it. Recompute in the same transaction as the column
// write so a failed update cannot leave half-completed columns behind.
onRecordUpdateRequest((e) => {
  if (!e.auth) return e.next()
  const original = e.record.original()
  if (!original || !original.id) return e.next()
  if (original.getBool("is_final") === e.record.getBool("is_final")) {
    return e.next()
  }

  const boardId = String(e.record.get("board") || "")
  const slug = String(e.record.get("slug") || "")
  const final = e.record.getBool("is_final")
  if (!boardId || !slug) return e.next()

  const previous = e.app
  $app.runInTransaction((txApp) => {
    e.app = txApp
    try {
      e.next()
      if (final) {
        txApp.db()
          .newQuery(
            "UPDATE tasks SET completed_at = {:now} WHERE board = {:board} AND status = {:status} AND COALESCE(completed_at, '') = ''"
          )
          .bind({ now: new Date().toISOString(), board: boardId, status: slug })
          .execute()
      } else {
        txApp.db()
          .newQuery(
            "UPDATE tasks SET completed_at = '' WHERE board = {:board} AND status = {:status} AND COALESCE(completed_at, '') != ''"
          )
          .bind({ board: boardId, status: slug })
          .execute()
      }
    } finally {
      e.app = previous
    }
  })
}, "board_columns")

onRecordDeleteRequest((e) => {
  if (!e.auth || e.hasSuperuserAuth()) return e.next()

  const tasks = $app.findRecordsByFilter(
    "tasks",
    "board = {:board} && status = {:status}",
    "",
    1,
    0,
    { board: String(e.record.get("board") || ""), status: String(e.record.get("slug") || "") }
  )
  if (tasks.length > 0) {
    throw new BadRequestError("This column still has tasks. Move them before deleting it.")
  }

  const columns = $app.findRecordsByFilter(
    "board_columns",
    "board = {:board}",
    "",
    0,
    0,
    { board: String(e.record.get("board") || "") }
  )
  if (columns.length <= 1) {
    throw new BadRequestError("A board needs at least one column.")
  }
  return e.next()
}, "board_columns")
