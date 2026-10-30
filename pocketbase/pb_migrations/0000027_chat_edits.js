/// <reference path="../pb_data/types.d.ts" />

// Chat and AI-edit foundation.
//
// - Documents carry a revision for optimistic concurrency and an actor label
//   so an edit can read as "Nana" rather than an anonymous record write.
// - Version snapshots can be marked as publish, AI, or undo and carry a full
//   before-state for undo.
// - Task activity records whether the actor was a user, AI, or system.
// - Messages keep the page context that was attached at send time and the
//   source links the UI renders under an answer.
// - chat_edits is the durable action log behind the chat's edit cards.

function findCollection(app, name) {
  try {
    return app.findCollectionByNameOrId(name)
  } catch (_) {
    return null
  }
}

function hasField(collection, name) {
  return Boolean(collection && collection.fields.getByName(name))
}

function addField(app, collection, field) {
  if (!collection || hasField(collection, field.name)) return
  collection.fields.add(field)
  app.save(collection)
}

function addIndex(app, collection, name, sql) {
  const indexes = collection.indexes || []
  for (let i = 0; i < indexes.length; i++) {
    if (String(indexes[i]).indexOf(name) !== -1) return
  }
  collection.indexes = indexes.concat([sql])
  app.save(collection)
}

function ensureDocumentFields(app, documents) {
  addField(app, documents, new NumberField({ name: "revision", required: false, min: 0 }))
  addField(
    app,
    app.findCollectionByNameOrId("documents"),
    new TextField({ name: "last_edited_by", max: 120 })
  )
  addField(
    app,
    app.findCollectionByNameOrId("documents"),
    new SelectField({
      name: "last_edit_source",
      required: false,
      maxSelect: 1,
      values: ["user", "ai", "system"],
    })
  )
}

function ensureVersionFields(app, versions) {
  addField(
    app,
    versions,
    new SelectField({
      name: "source",
      required: false,
      maxSelect: 1,
      values: ["publish", "ai", "undo"],
    })
  )
  addField(app, app.findCollectionByNameOrId("document_versions"), new JSONField({ name: "snapshot" }))
  addField(
    app,
    app.findCollectionByNameOrId("document_versions"),
    new SelectField({
      name: "actor_type",
      required: false,
      maxSelect: 1,
      values: ["user", "ai", "system"],
    })
  )
  addField(
    app,
    app.findCollectionByNameOrId("document_versions"),
    new TextField({ name: "actor_label", max: 120 })
  )
}

function ensureActivityFields(app, activity) {
  addField(
    app,
    activity,
    new SelectField({
      name: "actor_type",
      required: false,
      maxSelect: 1,
      values: ["user", "ai", "system"],
    })
  )
  addField(app, app.findCollectionByNameOrId("task_activity"), new TextField({ name: "actor_label", max: 120 }))
}

function ensureMessageFields(app, messages) {
  addField(app, messages, new JSONField({ name: "context" }))
  addField(app, app.findCollectionByNameOrId("messages"), new JSONField({ name: "sources" }))
  addField(app, app.findCollectionByNameOrId("messages"), new BoolField({ name: "stopped" }))
}

function ensureConversationFields(app, conversations) {
  addField(app, conversations, new TextField({ name: "summary", max: 20000 }))
}

function ensureChatEdits(app, conversations, messages, users) {
  let edits = findCollection(app, "chat_edits")
  if (edits) return edits

  edits = new Collection({
    name: "chat_edits",
    type: "base",
    listRule: "@request.auth.id != '' && conversation.author = @request.auth.id",
    viewRule: "@request.auth.id != '' && conversation.author = @request.auth.id",
    createRule: null,
    updateRule: null,
    deleteRule: null,
    indexes: [
      "CREATE INDEX `idx_chat_edits_conversation_created` ON `chat_edits` (`conversation`, `created`)",
      "CREATE INDEX `idx_chat_edits_target` ON `chat_edits` (`target_type`, `target_id`)",
    ],
  })
  edits.fields.add(
    new RelationField({
      name: "conversation",
      required: true,
      collectionId: conversations.id,
      cascadeDelete: true,
      maxSelect: 1,
    })
  )
  edits.fields.add(
    new RelationField({
      name: "message",
      required: false,
      collectionId: messages.id,
      cascadeDelete: true,
      maxSelect: 1,
    })
  )
  edits.fields.add(
    new RelationField({
      name: "actor",
      required: false,
      collectionId: users.id,
      cascadeDelete: false,
      maxSelect: 1,
    })
  )
  edits.fields.add(
    new SelectField({
      name: "actor_type",
      required: true,
      maxSelect: 1,
      values: ["user", "ai", "system"],
    })
  )
  edits.fields.add(new TextField({ name: "actor_label", max: 120 }))
  edits.fields.add(
    new SelectField({
      name: "target_type",
      required: true,
      maxSelect: 1,
      values: ["document", "board", "task"],
    })
  )
  edits.fields.add(new TextField({ name: "target_id", required: true, max: 64 }))
  edits.fields.add(new TextField({ name: "tool", required: true, max: 60 }))
  edits.fields.add(new TextField({ name: "summary", max: 500 }))
  edits.fields.add(new JSONField({ name: "operations" }))
  edits.fields.add(
    new SelectField({
      name: "status",
      required: true,
      maxSelect: 1,
      values: ["applied", "undone", "failed"],
    })
  )
  edits.fields.add(new AutodateField({ name: "created", onCreate: true, onUpdate: false }))
  edits.fields.add(new AutodateField({ name: "updated", onCreate: true, onUpdate: true }))
  app.save(edits)
  return edits
}

function backfill(app) {
  app.db().newQuery("UPDATE documents SET revision = 1 WHERE revision IS NULL OR revision = 0").execute()
  app.db().newQuery("UPDATE documents SET last_edit_source = 'system' WHERE last_edit_source IS NULL OR last_edit_source = ''").execute()
  app.db().newQuery("UPDATE document_versions SET source = 'publish' WHERE source IS NULL OR source = ''").execute()
  app.db().newQuery("UPDATE document_versions SET actor_type = 'user', actor_label = '' WHERE actor_type IS NULL OR actor_type = ''").execute()
  app.db().newQuery("UPDATE task_activity SET actor_type = CASE WHEN actor != '' THEN 'user' ELSE 'system' END WHERE actor_type IS NULL OR actor_type = ''").execute()
}

migrate(
  (app) => {
    const documents = app.findCollectionByNameOrId("documents")
    const versions = app.findCollectionByNameOrId("document_versions")
    const activity = app.findCollectionByNameOrId("task_activity")
    const messages = app.findCollectionByNameOrId("messages")
    const conversations = app.findCollectionByNameOrId("conversations")
    const users = app.findCollectionByNameOrId("users")

    ensureDocumentFields(app, documents)
    ensureVersionFields(app, versions)
    ensureActivityFields(app, activity)
    ensureMessageFields(app, messages)
    ensureConversationFields(app, conversations)
    ensureChatEdits(app, conversations, messages, users)

    addIndex(
      app,
      app.findCollectionByNameOrId("chat_edits"),
      "idx_chat_edits_conversation_created",
      "CREATE INDEX `idx_chat_edits_conversation_created` ON `chat_edits` (`conversation`, `created`)"
    )

    backfill(app)
    return null
  },
  (app) => {
    const documents = findCollection(app, "documents")
    if (documents) {
      for (const name of ["revision", "last_edited_by", "last_edit_source"]) {
        if (hasField(documents, name)) documents.fields.removeByName(name)
      }
      app.save(documents)
    }

    const versions = findCollection(app, "document_versions")
    if (versions) {
      for (const name of ["source", "snapshot", "actor_type", "actor_label"]) {
        if (hasField(versions, name)) versions.fields.removeByName(name)
      }
      app.save(versions)
    }

    const activity = findCollection(app, "task_activity")
    if (activity) {
      for (const name of ["actor_type", "actor_label"]) {
        if (hasField(activity, name)) activity.fields.removeByName(name)
      }
      app.save(activity)
    }

    const messages = findCollection(app, "messages")
    if (messages) {
      for (const name of ["context", "sources", "stopped"]) {
        if (hasField(messages, name)) messages.fields.removeByName(name)
      }
      app.save(messages)
    }

    const conversations = findCollection(app, "conversations")
    if (conversations && hasField(conversations, "summary")) {
      conversations.fields.removeByName("summary")
      app.save(conversations)
    }

    const edits = findCollection(app, "chat_edits")
    if (edits) app.delete(edits)

    return null
  }
)
