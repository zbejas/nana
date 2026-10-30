/// <reference path="../../pb_data/types.d.ts" />

// An assignee must already be able to read the board. Otherwise a task would
// point at a person who can never see it, and the assignee picker would leak
// names of unrelated users.

function assertAssignable(record, authId) {
  const assignee = String(record.get("assignee") || "")
  if (!assignee) return

  const boardId = String(record.get("board") || "")
  if (!boardId) throw new BadRequestError("A task requires a board.")

  let board
  try {
    board = $app.findRecordById("boards", boardId)
  } catch (_) {
    throw new BadRequestError("Board not found.")
  }

  if (String(board.get("author") || "") === assignee) return

  const direct = $app.findRecordsByFilter(
    "shares",
    "board = {:board} && user = {:user}",
    "",
    1,
    0,
    { board: boardId, user: assignee }
  )
  if (direct.length > 0) return

  const inherited = $app.findRecordsByFilter(
    "access_grants",
    "board = {:board} && user = {:user}",
    "",
    1,
    0,
    { board: boardId, user: assignee }
  )
  if (inherited.length > 0) return

  throw new BadRequestError("Choose someone who can access this board.")
}

module.exports = {
  assertAssignable,
}
