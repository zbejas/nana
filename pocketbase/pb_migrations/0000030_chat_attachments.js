/// <reference path="../pb_data/types.d.ts" />

// Chat attachments are owner-scoped rows that point at one protected file.
// Rows are created as drafts by the upload route, then bound to the user
// message after the message record exists. The extracted text stays on the
// server row and is never returned by the chat API.

const ATTACHMENT_RULE = "@request.auth.id != '' && author = @request.auth.id"

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
  if (!collection) return
  const indexes = collection.indexes || []
  for (let i = 0; i < indexes.length; i++) {
    if (String(indexes[i]).indexOf(name) !== -1) return
  }
  collection.indexes = indexes.concat([sql])
  app.save(collection)
}

function removeIndex(app, collection, name) {
  if (!collection) return
  const indexes = collection.indexes || []
  let found = false
  const next = []
  for (let i = 0; i < indexes.length; i++) {
    if (String(indexes[i]).indexOf(name) !== -1) {
      found = true
      continue
    }
    next.push(String(indexes[i]))
  }
  if (!found) return
  collection.indexes = next
  app.save(collection)
}

function ensureChatAttachments(app, users, conversations, messages) {
  let attachments = findCollection(app, "chat_attachments")
  if (!attachments) {
    // Indexes are added after the fields exist; PocketBase validates index
    // SQL when the collection is saved.
    attachments = new Collection({
      name: "chat_attachments",
      type: "base",
      listRule: ATTACHMENT_RULE,
      viewRule: ATTACHMENT_RULE,
      createRule: ATTACHMENT_RULE,
      updateRule: ATTACHMENT_RULE,
      deleteRule: ATTACHMENT_RULE,
    })
  }

  attachments.listRule = ATTACHMENT_RULE
  attachments.viewRule = ATTACHMENT_RULE
  attachments.createRule = ATTACHMENT_RULE
  attachments.updateRule = ATTACHMENT_RULE
  attachments.deleteRule = ATTACHMENT_RULE

  addField(
    app,
    attachments,
    new RelationField({
      name: "author",
      required: true,
      collectionId: users.id,
      cascadeDelete: true,
      maxSelect: 1,
    })
  )
  addField(
    app,
    attachments,
    new RelationField({
      name: "conversation",
      required: false,
      collectionId: conversations.id,
      cascadeDelete: true,
      maxSelect: 1,
    })
  )
  addField(
    app,
    attachments,
    new RelationField({
      name: "message",
      required: false,
      collectionId: messages.id,
      cascadeDelete: true,
      maxSelect: 1,
    })
  )
  addField(
    app,
    attachments,
    new FileField({
      name: "file",
      required: true,
      maxSelect: 1,
      maxSize: 50 * 1024 * 1024,
      protected: true,
    })
  )
  addField(app, attachments, new TextField({ name: "name", required: true, max: 255 }))
  addField(app, attachments, new TextField({ name: "mime_type", required: true, max: 120 }))
  addField(app, attachments, new NumberField({ name: "size", required: true, min: 0 }))
  addField(
    app,
    attachments,
    new SelectField({
      name: "kind",
      required: true,
      maxSelect: 1,
      values: ["image", "pdf", "text"],
    })
  )
  addField(app, attachments, new TextField({ name: "text", max: 1000000 }))
  addField(
    app,
    attachments,
    new AutodateField({ name: "created", onCreate: true, onUpdate: false })
  )
  app.save(attachments)

  addIndex(
    app,
    attachments,
    "idx_chat_attachments_author_message",
    "CREATE INDEX `idx_chat_attachments_author_message` ON `chat_attachments` (`author`, `message`)"
  )
  addIndex(
    app,
    attachments,
    "idx_chat_attachments_conversation",
    "CREATE INDEX `idx_chat_attachments_conversation` ON `chat_attachments` (`conversation`)"
  )

  return attachments
}

migrate(
  (app) => {
    const users = app.findCollectionByNameOrId("users")
    const conversations = app.findCollectionByNameOrId("conversations")
    const messages = app.findCollectionByNameOrId("messages")

    ensureChatAttachments(app, users, conversations, messages)

    addField(app, messages, new JSONField({ name: "attachments" }))
    return null
  },
  (app) => {
    const messages = findCollection(app, "messages")
    if (messages && hasField(messages, "attachments")) {
      messages.fields.removeByName("attachments")
      app.save(messages)
    }

    const attachments = findCollection(app, "chat_attachments")
    if (attachments) {
      removeIndex(app, attachments, "idx_chat_attachments_author_message")
      removeIndex(app, attachments, "idx_chat_attachments_conversation")
      app.delete(attachments)
    }

    return null
  }
)
