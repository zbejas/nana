/// <reference path="../pb_data/types.d.ts" />

// Tasks power the Board view. They are deliberately separate from documents:
// a note is a piece of writing, a task is a unit of work. A task may point at
// the note it came from, which is how "Add to board" on a note works.
migrate(
  (app) => {
    const usersCollection = app.findCollectionByNameOrId("users")
    const documentsCollection = app.findCollectionByNameOrId("documents")

    const tasksCollection = new Collection({
      name: "tasks",
      type: "base",
      listRule: "@request.auth.id != '' && author = @request.auth.id",
      viewRule: "@request.auth.id != '' && author = @request.auth.id",
      createRule: "@request.auth.id != ''",
      updateRule: "@request.auth.id != '' && author = @request.auth.id",
      deleteRule: "@request.auth.id != '' && author = @request.auth.id",
      indexes: [
        "CREATE INDEX `idx_tasks_author_status_order` ON `tasks` (`author`, `status`, `board_order`)",
      ],
    })

    tasksCollection.fields.add(new TextField({ name: "title", required: true, max: 240 }))
    tasksCollection.fields.add(new EditorField({ name: "description" }))
    tasksCollection.fields.add(
      new SelectField({
        name: "status",
        required: true,
        maxSelect: 1,
        values: ["backlog", "next", "progress", "done"],
      })
    )
    tasksCollection.fields.add(
      new SelectField({
        name: "priority",
        required: false,
        maxSelect: 1,
        values: ["low", "medium", "high", "urgent"],
      })
    )
    tasksCollection.fields.add(new DateField({ name: "due_date" }))
    tasksCollection.fields.add(new NumberField({ name: "board_order", required: false, min: 0 }))
    tasksCollection.fields.add(new JSONField({ name: "labels" }))
    tasksCollection.fields.add(
      new RelationField({
        name: "author",
        required: true,
        collectionId: usersCollection.id,
        cascadeDelete: false,
        maxSelect: 1,
      })
    )
    tasksCollection.fields.add(
      new RelationField({
        name: "document",
        required: false,
        collectionId: documentsCollection.id,
        cascadeDelete: false,
        maxSelect: 1,
      })
    )
    tasksCollection.fields.add(new AutodateField({ name: "created", onCreate: true, onUpdate: false }))
    tasksCollection.fields.add(new AutodateField({ name: "updated", onCreate: true, onUpdate: true }))

    app.save(tasksCollection)
    return null
  },
  (app) => {
    try {
      const collection = app.findCollectionByNameOrId("tasks")
      app.delete(collection)
    } catch (_) {
      // Collection already gone; nothing to roll back.
    }
    return null
  }
)
