/// <reference path="../pb_data/types.d.ts" />

// Tasks are author-scoped. The first migration only required an authenticated
// user on create; tighten it so a client cannot create a task under another
// author. List/view/update/delete were already author-scoped.
migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId("tasks")
    collection.createRule = "@request.auth.id != '' && author = @request.auth.id"
    app.save(collection)
    return null
  },
  (app) => {
    const collection = app.findCollectionByNameOrId("tasks")
    collection.createRule = "@request.auth.id != ''"
    app.save(collection)
    return null
  }
)
