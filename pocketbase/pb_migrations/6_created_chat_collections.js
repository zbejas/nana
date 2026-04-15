/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const usersCollection = app.findCollectionByNameOrId("users")

  // ── Conversations collection (messages stored inline as JSON) ──────
  const conversationsCollection = new Collection({
    name: "conversations",
    type: "base",
    listRule: "@request.auth.id != '' && author = @request.auth.id",
    viewRule: "@request.auth.id != '' && author = @request.auth.id",
    createRule: "@request.auth.id != ''",
    updateRule: "@request.auth.id != '' && author = @request.auth.id",
    deleteRule: "@request.auth.id != '' && author = @request.auth.id",
  })

  conversationsCollection.fields.add(new TextField({ name: "title", required: true }))
  conversationsCollection.fields.add(new RelationField({
    name: "author",
    required: true,
    collectionId: usersCollection.id,
    cascadeDelete: true,
    maxSelect: 1,
  }))
  conversationsCollection.fields.add(new JSONField({
    name: "messages",
    required: false,
    maxSize: 0,
  }))
  conversationsCollection.fields.add(new AutodateField({
    name: "created",
    onCreate: true,
    onUpdate: false,
  }))
  conversationsCollection.fields.add(new AutodateField({
    name: "updated",
    onCreate: true,
    onUpdate: true,
  }))

  app.save(conversationsCollection)

  return null
}, (app) => {
  try {
    const conversationsCollection = app.findCollectionByNameOrId("conversations")
    app.delete(conversationsCollection)
  } catch (_) {}

  return null
})
