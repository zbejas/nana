/// <reference path="../pb_data/types.d.ts" />

// Task attachments let a board item carry screenshots and reference files.
// The field mirrors document attachments: protected files, a bounded count,
// and image thumbnails for the compact task panel and card surfaces.

const MAX_FILES = 20
const MAX_BYTES = 50 * 1024 * 1024

migrate(
  (app) => {
    const tasks = app.findCollectionByNameOrId("tasks")
    if (!tasks.fields.getByName("attachments")) {
      tasks.fields.add(
        new FileField({
          name: "attachments",
          maxSelect: MAX_FILES,
          maxSize: MAX_BYTES,
          mimeTypes: [],
          thumbs: ["100x100", "300x0", "800x0"],
          protected: true,
        })
      )
      app.save(tasks)
    }
    return null
  },
  (app) => {
    const tasks = app.findCollectionByNameOrId("tasks")
    if (tasks.fields.getByName("attachments")) {
      tasks.fields.removeByName("attachments")
      app.save(tasks)
    }
    return null
  }
)
