/// <reference path="../../pb_data/types.d.ts" />

// Every new board owns four ordered workflow columns. Existing boards are
// backfilled by migration 0000025; this hook keeps the same shape for boards
// created through the API, MCP, or the app.

onRecordAfterCreateSuccess((e) => {
  const defaults = [
    { slug: "backlog", name: "Backlog", icon: "inbox", color: "muted", position: 0, final: false },
    { slug: "next", name: "Next up", icon: "queue", color: "warning", position: 1, final: false },
    { slug: "progress", name: "In progress", icon: "bolt", color: "signal", position: 2, final: false },
    { slug: "done", name: "Done", icon: "check", color: "success", position: 3, final: true },
  ]

  const boardId = String(e.record.id || "")
  if (!boardId) return

  let existing = []
  try {
    existing = $app.findRecordsByFilter(
      "board_columns",
      "board = {:board}",
      "+position",
      1,
      0,
      { board: boardId }
    )
  } catch (_) {
    return
  }
  if (existing.length > 0) return

  let collection
  try {
    collection = $app.findCollectionByNameOrId("board_columns")
  } catch (_) {
    return
  }

  for (let i = 0; i < defaults.length; i++) {
    const preset = defaults[i]
    const column = new Record(collection)
    column.set("board", boardId)
    column.set("slug", preset.slug)
    column.set("name", preset.name)
    column.set("position", preset.position)
    column.set("icon", preset.icon)
    column.set("color", preset.color)
    column.set("is_final", preset.final)
    $app.save(column)
  }
}, "boards")
