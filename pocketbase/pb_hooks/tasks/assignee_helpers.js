/// <reference path="../../pb_data/types.d.ts" />

// An assignee must already be able to read the board through the same effective
// access resolver the rules and custom routes use. Raw `shares`/`access_grants`
// rows are not enough: a stale grant on a private board, or a record inside a
// private folder, must not be assignable.

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

  const access = require(`${__hooks}/sharing/access_helpers.js`)
  const resolved = access.effectiveAccess("board", board.id, assignee)
  if (!resolved) {
    throw new BadRequestError("Choose someone who can access this board.")
  }
}

module.exports = {
  assertAssignable,
}
