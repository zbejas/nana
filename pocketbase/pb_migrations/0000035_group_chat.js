/// <reference path="../pb_data/types.d.ts" />

// Shared AI chat for notes.
//
// A note conversation is one group conversation per document. It is visible to
// the note owner and to every user with an effective person grant, but only the
// note owner can manage (rename/delete) the conversation or its messages. Group
// creation is server-only: the Bun chat API creates it with the superuser after
// resolving access, so `conversations.create` never accepts `scope = "note"`.
//
// The existing personal conversation rows are backfilled to `personal`; the new
// `messages.author`/`author_label` fields let the group transcript show who
// spoke without exposing email addresses.

const AUTHOR_RULE = "@request.auth.id != '' && author = @request.auth.id"
const MESSAGE_RULE =
  "@request.auth.id != '' && conversation.author = @request.auth.id"
const CHAT_EDIT_RULE =
  "@request.auth.id != '' && conversation.author = @request.auth.id"

const PERSONAL_CONVERSATION =
  "(scope = '' || scope = 'personal') && author = @request.auth.id"
const PERSONAL_MESSAGE =
  "(conversation.scope = '' || conversation.scope = 'personal') && conversation.author = @request.auth.id"
const PERSONAL_CHAT_EDIT = PERSONAL_MESSAGE

// Owner can always see the bound note; a participant needs a share grant and a
// live, non-private document. Public-link flags deliberately do not appear.
const GROUP_CONVERSATION_ACCESS =
  "(document.author = @request.auth.id || (document.is_private = false && document.deleted_at = '' && document.access_grants_via_document.user ?= @request.auth.id))"
const GROUP_MESSAGE_ACCESS =
  "(conversation.document.author = @request.auth.id || (conversation.document.is_private = false && conversation.document.deleted_at = '' && conversation.document.access_grants_via_document.user ?= @request.auth.id))"

const CONVERSATION_LIST_VIEW =
  `@request.auth.id != '' && ((${PERSONAL_CONVERSATION}) || (scope = 'note' && ${GROUP_CONVERSATION_ACCESS}))`
const CONVERSATION_MANAGE =
  `@request.auth.id != '' && ((${PERSONAL_CONVERSATION}) || (scope = 'note' && document.author = @request.auth.id))`
const CONVERSATION_CREATE =
  "@request.auth.id != '' && author = @request.auth.id && (scope = '' || scope = 'personal')"

const MESSAGE_LIST_VIEW =
  `@request.auth.id != '' && ((${PERSONAL_MESSAGE}) || (conversation.scope = 'note' && ${GROUP_MESSAGE_ACCESS}))`
const MESSAGE_CREATE =
  `@request.auth.id != '' && ((${PERSONAL_MESSAGE}) || (conversation.scope = 'note' && ${GROUP_MESSAGE_ACCESS} && ((role = 'user' && author = @request.auth.id) || (role = 'assistant' && author = ''))))`
const MESSAGE_MANAGE =
  `@request.auth.id != '' && ((${PERSONAL_MESSAGE}) || (conversation.scope = 'note' && conversation.document.author = @request.auth.id))`

const CHAT_EDIT_LIST_VIEW =
  `@request.auth.id != '' && ((${PERSONAL_CHAT_EDIT}) || (conversation.scope = 'note' && ${GROUP_MESSAGE_ACCESS}))`

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

function removeField(collection, name) {
  if (!hasField(collection, name)) return false
  collection.fields.removeByName(name)
  return true
}

function hasIndex(collection, name) {
  const indexes = collection.indexes || []
  for (let i = 0; i < indexes.length; i += 1) {
    if (String(indexes[i]).indexOf(name) !== -1) return true
  }
  return false
}

function removeIndex(collection, name) {
  const indexes = collection.indexes || []
  const next = indexes.filter((index) => String(index).indexOf(name) === -1)
  if (next.length === indexes.length) return false
  collection.indexes = next
  return true
}

function ensureConversationFields(app, conversations, documents) {
  if (!conversations || !documents) return
  let changed = false

  if (!hasField(conversations, "scope")) {
    conversations.fields.add(
      new SelectField({
        name: "scope",
        required: false,
        maxSelect: 1,
        values: ["personal", "note"],
      })
    )
    changed = true
  }

  if (!hasField(conversations, "document")) {
    conversations.fields.add(
      new RelationField({
        name: "document",
        required: false,
        collectionId: documents.id,
        cascadeDelete: true,
        maxSelect: 1,
      })
    )
    changed = true
  }

  if (changed) app.save(conversations)
}

function ensureMessageFields(app, messages, users) {
  if (!messages || !users) return
  let changed = false

  if (!hasField(messages, "author")) {
    messages.fields.add(
      new RelationField({
        name: "author",
        required: false,
        collectionId: users.id,
        cascadeDelete: false,
        maxSelect: 1,
      })
    )
    changed = true
  }

  if (!hasField(messages, "author_label")) {
    messages.fields.add(new TextField({ name: "author_label", max: 120 }))
    changed = true
  }

  if (changed) app.save(messages)
}

function ensureIndexes(app, conversations) {
  if (!conversations) return
  const name = "idx_conversations_document_note"
  if (hasIndex(conversations, name)) return
  conversations.indexes = (conversations.indexes || []).concat([
    "CREATE UNIQUE INDEX `idx_conversations_document_note` ON `conversations` (`document`) WHERE `scope` = 'note' AND `document` != ''",
  ])
  app.save(conversations)
}

function applyRules(app, conversations, messages, edits) {
  if (conversations) {
    conversations.listRule = CONVERSATION_LIST_VIEW
    conversations.viewRule = CONVERSATION_LIST_VIEW
    conversations.createRule = CONVERSATION_CREATE
    conversations.updateRule = CONVERSATION_MANAGE
    conversations.deleteRule = CONVERSATION_MANAGE
    app.save(conversations)
  }

  if (messages) {
    messages.listRule = MESSAGE_LIST_VIEW
    messages.viewRule = MESSAGE_LIST_VIEW
    messages.createRule = MESSAGE_CREATE
    messages.updateRule = MESSAGE_MANAGE
    messages.deleteRule = MESSAGE_MANAGE
    app.save(messages)
  }

  if (edits) {
    edits.listRule = CHAT_EDIT_LIST_VIEW
    edits.viewRule = CHAT_EDIT_LIST_VIEW
    app.save(edits)
  }
}

function backfill(app) {
  const db = app.db()

  // Every existing conversation was personal; explicit values keep the rules
  // below unambiguous while the field remains optional for older clients.
  db.newQuery(
    "UPDATE conversations SET scope = 'personal' WHERE scope IS NULL OR scope = ''"
  ).execute()

  // Existing personal user turns learn who spoke. Assistant turns stay empty.
  db.newQuery(
    "UPDATE messages SET author = (SELECT author FROM conversations WHERE conversations.id = messages.conversation) WHERE role = 'user' AND (author IS NULL OR author = '')"
  ).execute()

  db.newQuery(
    "UPDATE messages SET author_label = COALESCE((SELECT name FROM users WHERE users.id = messages.author), '') WHERE role = 'user' AND (author_label IS NULL OR author_label = '')"
  ).execute()
}

function restoreRules(app) {
  const conversations = findCollection(app, "conversations")
  if (conversations) {
    conversations.listRule = AUTHOR_RULE
    conversations.viewRule = AUTHOR_RULE
    conversations.createRule = AUTHOR_RULE
    conversations.updateRule = AUTHOR_RULE
    conversations.deleteRule = AUTHOR_RULE
    app.save(conversations)
  }

  const messages = findCollection(app, "messages")
  if (messages) {
    messages.listRule = MESSAGE_RULE
    messages.viewRule = MESSAGE_RULE
    messages.createRule = MESSAGE_RULE
    messages.updateRule = MESSAGE_RULE
    messages.deleteRule = MESSAGE_RULE
    app.save(messages)
  }

  const edits = findCollection(app, "chat_edits")
  if (edits) {
    edits.listRule = CHAT_EDIT_RULE
    edits.viewRule = CHAT_EDIT_RULE
    app.save(edits)
  }
}

function removeAddedFields(app) {
  const conversations = findCollection(app, "conversations")
  if (conversations) {
    const changedIndex = removeIndex(conversations, "idx_conversations_document_note")
    const changedScope = removeField(conversations, "scope")
    const changedDocument = removeField(conversations, "document")
    if (changedIndex || changedScope || changedDocument) app.save(conversations)
  }

  const messages = findCollection(app, "messages")
  if (messages) {
    const changedAuthor = removeField(messages, "author")
    const changedLabel = removeField(messages, "author_label")
    if (changedAuthor || changedLabel) app.save(messages)
  }
}

migrate(
  (app) => {
    const conversations = findCollection(app, "conversations")
    const messages = findCollection(app, "messages")
    const edits = findCollection(app, "chat_edits")
    const documents = findCollection(app, "documents")
    const users = findCollection(app, "users")

    if (!conversations || !messages || !documents || !users) {
      throw new Error("Group chat requires conversations, messages, documents, and users")
    }

    ensureConversationFields(app, conversations, documents)
    ensureMessageFields(app, messages, users)
    ensureIndexes(app, conversations)
    backfill(app)
    applyRules(app, conversations, messages, edits)
    return null
  },
  (app) => {
    restoreRules(app)
    removeAddedFields(app)
    return null
  }
)
