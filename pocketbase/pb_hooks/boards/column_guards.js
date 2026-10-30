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
