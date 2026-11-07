/// <reference path="../pb_data/types.d.ts" />

// The default first column is a to-do lane, not the virtual backlog view.
// Keep the stable `backlog` slug so task statuses and saved URLs do not move;
// rename only the default label on existing boards.

migrate(
  (app) => {
    let columns = []
    try {
      columns = app.findRecordsByFilter(
        "board_columns",
        "slug = {:slug} && name = {:name}",
        "",
        0,
        0,
        { slug: "backlog", name: "Backlog" }
      )
    } catch (_) {
      return null
    }

    for (let i = 0; i < columns.length; i++) {
      columns[i].set("name", "Todo")
      app.save(columns[i])
    }
    return null
  },
  (app) => {
    let columns = []
    try {
      columns = app.findRecordsByFilter(
        "board_columns",
        "slug = {:slug} && name = {:name}",
        "",
        0,
        0,
        { slug: "backlog", name: "Todo" }
      )
    } catch (_) {
      return null
    }

    for (let i = 0; i < columns.length; i++) {
      columns[i].set("name", "Backlog")
      app.save(columns[i])
    }
    return null
  }
)
