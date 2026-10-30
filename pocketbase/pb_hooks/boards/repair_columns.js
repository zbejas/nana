/// <reference path="../../pb_data/types.d.ts" />

// Operator repair path for partial column seeding and failed grant rebuilds.
// Admin-only; normal owners never need to call it. The same column repair runs
// hourly for boards that have no columns at all.

routerAdd("POST", "/api/admin/repair-kanban", (c) => {
  const { requireAdmin, parseRequestBody, sendError } = require(`${__hooks}/utils.js`)
  const columns = require(`${__hooks}/boards/column_helpers.js`)

  try {
    requireAdmin(c)
    const body = parseRequestBody(c)
    const boardId = String(body.boardId || "").trim()

    let columnResult = { added: 0 }
    if (boardId) {
      if (!boardId.match(/^[a-z0-9]{15}$/)) {
        throw new BadRequestError("Invalid board id")
      }
      columnResult = columns.ensureBoardColumns(boardId, $app)
    } else {
      columnResult = columns.repairEmptyBoards($app)
    }

    const repair = require(`${__hooks}/sharing/repair_helpers.js`)
    const grants = repair.repairPending($app)

    return c.json(200, {
      success: true,
      columnsAdded: columnResult.added,
      boardsRepaired: columnResult.boards || 0,
      grantsRepaired: grants.repaired,
      grantsFailed: grants.failed,
    })
  } catch (err) {
    return sendError(c, err, "Failed to repair kanban data")
  }
}, $apis.requireAuth())

cronAdd("kanban-empty-board-repair", "23 * * * *", () => {
  try {
    const columns = require(`${__hooks}/boards/column_helpers.js`)
    const result = columns.repairEmptyBoards($app)
    if (result.boards > 0) {
      console.log(`Repaired default columns for ${result.boards} empty board(s)`)
    }
  } catch (err) {
    console.error("Failed to repair empty board columns:", err)
  }
})
