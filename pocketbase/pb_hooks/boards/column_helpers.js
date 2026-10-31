/// <reference path="../../pb_data/types.d.ts" />

// Idempotent default-column seeding. The board record is already committed by
// the time the create hook runs, so this helper must never throw: each column
// is upserted independently and a failed save is logged, leaving the board
// usable and the repair route able to finish the job later.

const DEFAULT_COLUMNS = [
  { slug: "backlog", name: "Backlog", icon: "inbox", color: "muted", position: 0, final: false },
  { slug: "next", name: "Next up", icon: "queue", color: "warning", position: 1, final: false },
  { slug: "progress", name: "In progress", icon: "bolt", color: "signal", position: 2, final: false },
  { slug: "done", name: "Done", icon: "check", color: "success", position: 3, final: true },
]

const RESERVED_SLUGS = { planned: true, archived: true }

function appOrGlobal(app) {
  return app || $app
}

function findCollection(app) {
  try {
    return appOrGlobal(app).findCollectionByNameOrId("board_columns")
  } catch (_) {
    return null
  }
}

function columnsForBoard(boardId, app) {
  try {
    return appOrGlobal(app).findRecordsByFilter(
      "board_columns",
      "board = {:board}",
      "+position",
      0,
      0,
      { board: boardId }
    )
  } catch (_) {
    return []
  }
}

/**
 * Add only the missing defaults for one board, keyed by `(board, slug)`.
 * Existing columns (including custom ones) are never touched.
 */
function ensureBoardColumns(boardId, app) {
  const db = appOrGlobal(app)
  const collection = findCollection(db)
  if (!collection || !boardId) return { added: 0, existing: 0 }

  const columns = columnsForBoard(boardId, db)
  const bySlug = {}
  const usedPositions = {}
  for (let i = 0; i < columns.length; i++) {
    const slug = String(columns[i].get("slug") || "")
    if (slug) bySlug[slug] = true
    const position = Number(columns[i].get("position") || 0)
    usedPositions[position] = true
  }

  let added = 0
  for (let i = 0; i < DEFAULT_COLUMNS.length; i++) {
    const preset = DEFAULT_COLUMNS[i]
    if (bySlug[preset.slug] || RESERVED_SLUGS[preset.slug]) continue

    let position = preset.position
    while (usedPositions[position]) position += 1

    try {
      const column = new Record(collection)
      column.set("board", boardId)
      column.set("slug", preset.slug)
      column.set("name", preset.name)
      column.set("position", position)
      column.set("icon", preset.icon)
      column.set("color", preset.color)
      column.set("is_final", preset.final)
      db.save(column)
      bySlug[preset.slug] = true
      usedPositions[position] = true
      added += 1
    } catch (err) {
      // A concurrent seeder may have inserted the same (board, slug) between
      // the read and the save. That is success, not a reason to fail the board.
      const retry = columnsForBoard(boardId, db)
      let present = false
      for (let j = 0; j < retry.length; j++) {
        if (String(retry[j].get("slug") || "") === preset.slug) present = true
      }
      if (!present) {
        console.error("Failed to seed board column:", boardId, preset.slug, err)
      }
    }
  }

  return { added, existing: columns.length }
}

/** Repair boards that lost every column (the create hook always adds defaults). */
function repairEmptyBoards(app) {
  const db = appOrGlobal(app)
  let boards = []
  try {
    boards = db.findRecordsByFilter("boards", "", "+created", 0, 0)
  } catch (_) {
    return { boards: 0, added: 0 }
  }

  let repaired = 0
  let added = 0
  for (let i = 0; i < boards.length; i++) {
    const columns = columnsForBoard(boards[i].id, db)
    if (columns.length > 0) continue
    const result = ensureBoardColumns(boards[i].id, db)
    if (result.added > 0) repaired += 1
    added += result.added
  }
  return { boards: repaired, added }
}

module.exports = {
  DEFAULT_COLUMNS,
  RESERVED_SLUGS,
  columnsForBoard,
  ensureBoardColumns,
  repairEmptyBoards,
}
