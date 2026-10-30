/// <reference path="../../pb_data/types.d.ts" />

// Every new board owns four ordered workflow columns. Existing boards are
// backfilled by migration 0000025 and repaired by 0000028; this hook keeps the
// same shape for boards created through the API, MCP, or the app.
//
// The board is already committed when this after-create hook runs, so seeding
// is idempotent, keyed by (board, slug), and never throws. A missing column is
// repaired by the admin repair route or the empty-board cron.

onRecordAfterCreateSuccess((e) => {
  const boardId = String(e.record.id || "")
  if (!boardId) return
  try {
    const h = require(`${__hooks}/boards/column_helpers.js`)
    h.ensureBoardColumns(boardId, $app)
  } catch (err) {
    // The board row is already committed; never turn a seeding problem into a
    // failed create. The repair route/cron fills the gaps later.
    console.error("Failed to seed board columns:", boardId, err)
  }
}, "boards")
