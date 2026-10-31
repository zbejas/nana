/// <reference path="../pb_data/types.d.ts" />

// Relational remodel.
//
// Goals:
// - Trash is a state on documents/folders, not three duplicate collections.
// - Chat messages are records, not a JSON blob on the conversation.
// - Ownership is stored once per aggregate (tasks inherit from their board).
// - Relations carry the indexes and cascade rules their access paths need.
// - Every migrated structure has a reversal path in down().
//
// Existing trash rows and conversation messages are copied into the new shape
// before the old columns/collections are dropped. Task and version ownership
// now derives from their board/document relations instead of duplicate authors.

const AUTHOR_RULE = "@request.auth.id != '' && author = @request.auth.id"
const VISIBLE_RULE =
  "@request.auth.id != '' && author = @request.auth.id && deleted_at = ''"
const VERSION_RULE =
  "@request.auth.id != '' && document.author = @request.auth.id && document.deleted_at = ''"
const TASK_READ_RULE = "@request.auth.id != '' && board.author = @request.auth.id"
const TASK_WRITE_RULE =
  "@request.auth.id != '' && board.author = @request.auth.id && board.archived = false"
const MESSAGE_RULE =
  "@request.auth.id != '' && conversation.author = @request.auth.id"

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

function ensureField(collection, field) {
  if (!hasField(collection, field.name)) {
    collection.fields.add(field)
  }
}

function hasIndex(collection, name) {
  const indexes = collection.indexes || []
  for (let i = 0; i < indexes.length; i++) {
    if (String(indexes[i]).indexOf(name) !== -1) {
      return true
    }
  }
  return false
}

function indexesWithout(collection, name) {
  const next = []
  const indexes = collection.indexes || []
  for (let i = 0; i < indexes.length; i++) {
    if (String(indexes[i]).indexOf(name) === -1) {
      next.push(String(indexes[i]))
    }
  }
  return next
}

function ensureIndex(app, collection, name, sql) {
  if (!collection || hasIndex(collection, name)) {
    return
  }
  collection.indexes = indexesWithout(collection, name).concat([sql])
  app.save(collection)
}

function removeIndex(app, collection, name) {
  if (!collection || !hasIndex(collection, name)) {
    return
  }
  collection.indexes = indexesWithout(collection, name)
  app.save(collection)
}

function readField(record, name) {
  try {
    return record.get(name)
  } catch (_) {
    return ""
  }
}

function textField(record, name) {
  const value = readField(record, name)
  return value === null || value === undefined ? "" : String(value)
}

/**
 * JSON fields occasionally reach the JSVM as raw byte arrays (for example
 * when a value was written by an older PocketBase release). Normalize both
 * that representation and plain strings before using the value.
 */
function jsonValue(value, fallback) {
  if (value === null || value === undefined || value === "") {
    return fallback
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return value
    }
    if (typeof value[0] === "number") {
      try {
        return JSON.parse(toString(value))
      } catch (_) {
        return fallback
      }
    }
    return value
  }

  if (typeof value === "string") {
    try {
      return JSON.parse(value)
    } catch (_) {
      return fallback
    }
  }

  if (typeof value === "object") {
    try {
      return JSON.parse(toString(value))
    } catch (_) {
      return fallback
    }
  }

  return fallback
}

function fileFieldNames(record, fieldName) {
  const value = readField(record, fieldName)
  if (Array.isArray(value)) {
    return value.filter(Boolean).map((item) => String(item))
  }
  if (!value) {
    return []
  }
  return [String(value)]
}

// The reuploadable File handles stay tied to the filesystem, so the caller
// must save the target before the filesystem closes.
function withClonedFiles(app, source, filenames, save) {
  if (!filenames.length) {
    save([])
    return
  }

  const filesystem = app.newFilesystem()
  try {
    const base = String(source.baseFilesPath() || "").replace(/\/+$/, "")
    const files = filenames.map((filename) => {
      return filesystem.getReuploadableFile(
        `${base}/${String(filename).replace(/^\/+/, "")}`,
        true
      )
    })
    save(files)
  } finally {
    filesystem.close()
  }
}

function recordExists(app, collectionName, id) {
  if (!id) {
    return false
  }
  try {
    app.findRecordById(collectionName, id)
    return true
  } catch (_) {
    return false
  }
}

function recordsOf(app, collectionName, filter, sort) {
  if (!findCollection(app, collectionName)) {
    return []
  }
  return app.findRecordsByFilter(collectionName, filter || "", sort || "", 0, 0)
}

function dedupeAndIndexTokens(app, collectionName, indexName) {
  const collection = findCollection(app, collectionName)
  if (!collection || !hasField(collection, "public_share_token")) {
    return
  }

  const seen = {}
  const records = recordsOf(
    app,
    collectionName,
    "public_share_token != ''",
    "+created"
  )

  for (let i = 0; i < records.length; i++) {
    const record = records[i]
    if (!record) continue
    const token = textField(record, "public_share_token")
    if (!token) continue
    if (seen[token]) {
      record.set("public_share_token", "")
      record.set("is_public", false)
      record.set("public_expires_at", "")
      app.save(record)
      continue
    }
    seen[token] = true
  }

  ensureIndex(
    app,
    collection,
    indexName,
    "CREATE UNIQUE INDEX `" +
      indexName +
      "` ON `" +
      collectionName +
      "` (`public_share_token`) WHERE `public_share_token` != ''"
  )
}

// ── Trash state ─────────────────────────────────────────────────────

function ensureTrashFields(app, users) {
  const folders = findCollection(app, "folders")
  if (!folders) {
    throw new Error("folders collection not found")
  }

  ensureField(
    folders,
    new DateField({ name: "deleted_at", required: false })
  )
  ensureField(
    folders,
    new RelationField({
      name: "deleted_by",
      required: false,
      collectionId: users.id,
      cascadeDelete: false,
      maxSelect: 1,
    })
  )

  const parent = folders.fields.getByName("parent")
  if (parent) {
    parent.cascadeDelete = true
  }

  if (hasField(folders, "published")) {
    folders.fields.removeByName("published")
  }

  folders.listRule = VISIBLE_RULE
  folders.viewRule = VISIBLE_RULE
  folders.createRule = AUTHOR_RULE
  folders.updateRule = VISIBLE_RULE
  folders.deleteRule = null

  app.save(folders)

  ensureIndex(
    app,
    folders,
    "idx_folders_author_deleted_parent",
    "CREATE INDEX `idx_folders_author_deleted_parent` ON `folders` (`author`, `deleted_at`, `parent`)"
  )

  const documents = findCollection(app, "documents")
  if (!documents) {
    throw new Error("documents collection not found")
  }

  ensureField(
    documents,
    new DateField({ name: "deleted_at", required: false })
  )
  ensureField(
    documents,
    new RelationField({
      name: "deleted_by",
      required: false,
      collectionId: users.id,
      cascadeDelete: false,
      maxSelect: 1,
    })
  )

  const folder = documents.fields.getByName("folder")
  if (folder) {
    folder.cascadeDelete = true
  }

  documents.listRule = VISIBLE_RULE
  documents.viewRule = VISIBLE_RULE
  documents.createRule = AUTHOR_RULE
  documents.updateRule = VISIBLE_RULE
  documents.deleteRule = null

  app.save(documents)

  ensureIndex(
    app,
    documents,
    "idx_documents_author_deleted_folder",
    "CREATE INDEX `idx_documents_author_deleted_folder` ON `documents` (`author`, `deleted_at`, `folder`)"
  )
  ensureIndex(
    app,
    documents,
    "idx_documents_author_deleted_updated",
    "CREATE INDEX `idx_documents_author_deleted_updated` ON `documents` (`author`, `deleted_at`, `updated`)"
  )

  dedupeAndIndexTokens(app, "documents", "idx_documents_share_token")
}

function legacyTrashCollections(app) {
  return {
    folders: findCollection(app, "trash_folders"),
    documents: findCollection(app, "trash_documents"),
    versions: findCollection(app, "trash_document_versions"),
  }
}

/**
 * Copy legacy trash rows back into the live tables as soft-deleted records.
 * Original ids are reused when free so task links and URLs survive.
 */
function mergeLegacyTrash(app) {
  const legacy = legacyTrashCollections(app)
  if (!legacy.folders && !legacy.documents && !legacy.versions) {
    return
  }

  const foldersCollection = findCollection(app, "folders")
  const documentsCollection = findCollection(app, "documents")
  const versionsCollection = findCollection(app, "document_versions")
  const folderMap = {}
  const documentMap = {}
  const now = new Date().toISOString()

  function restoreFolder(trashRecord, seen) {
    if (!trashRecord) return ""
    const trashId = trashRecord.id
    if (folderMap[trashId]) {
      return folderMap[trashId]
    }
    if (seen[trashId]) {
      return ""
    }
    seen[trashId] = true

    const originalId = textField(trashRecord, "original_folder_id")
    let liveId = originalId && recordExists(app, "folders", originalId)
      ? originalId
      : ""

    if (!liveId) {
      let parentId = ""
      const trashParentId = textField(trashRecord, "parent")
      if (trashParentId && legacy.folders) {
        try {
          const trashParent = app.findRecordById(
            "trash_folders",
            trashParentId
          )
          parentId = restoreFolder(trashParent, seen)
        } catch (_) {
          parentId = ""
        }
      }

      if (!parentId) {
        const originalParentId = textField(
          trashRecord,
          "original_parent_folder_id"
        )
        if (
          originalParentId &&
          originalParentId !== originalId &&
          recordExists(app, "folders", originalParentId)
        ) {
          parentId = originalParentId
        }
      }

      const target = new Record(foldersCollection)
      if (originalId && !recordExists(app, "folders", originalId)) {
        target.id = originalId
      }
      target.set("name", textField(trashRecord, "name") || "Untitled folder")
      target.set("author", textField(trashRecord, "author"))
      target.set("color", textField(trashRecord, "color"))
      target.set("parent", parentId)
      target.set("is_private", false)
      target.set("is_public", false)
      target.set("public_share_token", "")
      target.set("public_expires_at", "")
      target.set("share_attachments", false)
      target.set("deleted_at", textField(trashRecord, "deleted_at") || now)
      target.set(
        "deleted_by",
        textField(trashRecord, "deleted_by") ||
          textField(trashRecord, "author")
      )
      app.save(target)
      liveId = target.id
    }

    folderMap[trashId] = liveId
    return liveId
  }

  if (legacy.folders) {
    const trashFolders = recordsOf(app, "trash_folders", "", "+created")
    for (let i = 0; i < trashFolders.length; i++) {
      restoreFolder(trashFolders[i], {})
    }
  }

  if (legacy.documents) {
    const trashDocuments = recordsOf(app, "trash_documents", "", "+created")
    for (let i = 0; i < trashDocuments.length; i++) {
      const trashRecord = trashDocuments[i]
      if (!trashRecord) continue

      const originalId = textField(trashRecord, "original_document_id")
      let liveId = originalId && recordExists(app, "documents", originalId)
        ? originalId
        : ""
      let target = null

      if (!liveId) {
        target = new Record(documentsCollection)
        if (originalId && !recordExists(app, "documents", originalId)) {
          target.id = originalId
        }

        let folderId = ""
        const trashFolderId = textField(trashRecord, "folder")
        if (trashFolderId && folderMap[trashFolderId]) {
          folderId = folderMap[trashFolderId]
        } else {
          const originalFolderId = textField(trashRecord, "original_folder_id")
          if (
            originalFolderId &&
            recordExists(app, "folders", originalFolderId)
          ) {
            folderId = originalFolderId
          }
        }

        target.set("title", textField(trashRecord, "title") || "Untitled")
        target.set("slug", textField(trashRecord, "slug"))
        target.set("content", textField(trashRecord, "content"))
        target.set("tags", jsonValue(readField(trashRecord, "tags"), []))
        target.set("published", false)
        target.set("author", textField(trashRecord, "author"))
        target.set(
          "word_count",
          Number(readField(trashRecord, "word_count") || 0)
        )
        target.set(
          "reading_time",
          Number(readField(trashRecord, "reading_time") || 0)
        )
        target.set("folder", folderId)
        target.set("is_private", false)
        target.set("is_public", false)
        target.set("public_share_token", "")
        target.set("public_expires_at", "")
        target.set("share_attachments", false)
        target.set("deleted_at", textField(trashRecord, "deleted_at") || now)
        target.set(
          "deleted_by",
          textField(trashRecord, "deleted_by") ||
            textField(trashRecord, "author")
        )

        const filenames = fileFieldNames(trashRecord, "attachments")
        withClonedFiles(app, trashRecord, filenames, (files) => {
          target.set("attachments", files)
          app.save(target)
        })
        liveId = target.id
      }

      documentMap[trashRecord.id] = liveId
      if (originalId) {
        documentMap[originalId] = liveId
      }
    }
  }

  if (legacy.versions && versionsCollection) {
    const trashVersions = recordsOf(
      app,
      "trash_document_versions",
      "",
      "+created"
    )
    for (let i = 0; i < trashVersions.length; i++) {
      const trashVersion = trashVersions[i]
      if (!trashVersion) continue

      const documentId =
        documentMap[textField(trashVersion, "trash_document")] ||
        documentMap[textField(trashVersion, "original_document_id")]
      if (!documentId) continue

      const originalVersionId = textField(
        trashVersion,
        "original_version_id"
      )
      if (
        originalVersionId &&
        recordExists(app, "document_versions", originalVersionId)
      ) {
        continue
      }

      const versionNumber = Number(
        readField(trashVersion, "version_number") || 0
      )
      const existing = app.findRecordsByFilter(
        "document_versions",
        'document = {:document} && version_number = {:number}',
        "",
        1,
        0,
        { document: documentId, number: versionNumber }
      )
      if (existing && existing.length > 0) {
        continue
      }

      const target = new Record(versionsCollection)
      if (
        originalVersionId &&
        !recordExists(app, "document_versions", originalVersionId)
      ) {
        target.id = originalVersionId
      }
      target.set("document", documentId)
      target.set("content", textField(trashVersion, "content"))
      target.set("version_number", versionNumber || 1)
      target.set(
        "change_summary",
        textField(trashVersion, "change_summary")
      )
      target.set(
        "source_created_at",
        textField(trashVersion, "source_created_at") ||
          textField(trashVersion, "created") ||
          null
      )
      app.save(target)
    }
  }

  // Drop the legacy storage only after every row and attachment has a home.
  if (legacy.versions) app.delete(legacy.versions)
  if (legacy.documents) app.delete(legacy.documents)
  if (legacy.folders) app.delete(legacy.folders)
}

function createTrashViews(app) {
  const views = [
    {
      name: "trash_documents",
      query:
        "SELECT id, title, slug, content, attachments, tags, published, author, word_count, reading_time, folder, created, updated, is_public, public_share_token, public_expires_at, is_private, share_attachments, deleted_at, deleted_by FROM documents WHERE deleted_at != ''",
    },
    {
      name: "trash_folders",
      query:
        "SELECT id, name, author, color, created, updated, parent, is_public, public_share_token, public_expires_at, is_private, share_attachments, deleted_at, deleted_by FROM folders WHERE deleted_at != ''",
    },
  ]

  for (let i = 0; i < views.length; i++) {
    const entry = views[i]
    let collection = findCollection(app, entry.name)
    if (collection && collection.type !== "view") {
      app.delete(collection)
      collection = null
    }

    if (!collection) {
      collection = new Collection({
        name: entry.name,
        type: "view",
        viewQuery: entry.query,
        listRule: AUTHOR_RULE,
        viewRule: AUTHOR_RULE,
      })
    } else {
      collection.viewQuery = entry.query
      collection.listRule = AUTHOR_RULE
      collection.viewRule = AUTHOR_RULE
    }
    app.save(collection)
  }
}

// ── Chat messages ──────────────────────────────────────────────────

function ensureMessagesCollection(app) {
  const conversations = findCollection(app, "conversations")
  if (!conversations) {
    return null
  }

  let messages = findCollection(app, "messages")
  if (!messages) {
    messages = new Collection({
      name: "messages",
      type: "base",
      listRule: MESSAGE_RULE,
      viewRule: MESSAGE_RULE,
      createRule: MESSAGE_RULE,
      updateRule: MESSAGE_RULE,
      deleteRule: MESSAGE_RULE,
      indexes: [
        "CREATE INDEX `idx_messages_conversation_position` ON `messages` (`conversation`, `position`)",
      ],
    })

    messages.fields.add(
      new RelationField({
        name: "conversation",
        required: true,
        collectionId: conversations.id,
        cascadeDelete: true,
        maxSelect: 1,
      })
    )
    messages.fields.add(
      new SelectField({
        name: "role",
        required: true,
        maxSelect: 1,
        values: ["user", "assistant"],
      })
    )
    messages.fields.add(new EditorField({ name: "content" }))
    messages.fields.add(new TextField({ name: "reasoning" }))
    messages.fields.add(new TextField({ name: "model", max: 120 }))
    messages.fields.add(new JSONField({ name: "tools" }))
    messages.fields.add(
      new NumberField({ name: "position", required: false, min: 0 })
    )
    messages.fields.add(
      new AutodateField({ name: "created", onCreate: true, onUpdate: false })
    )
    app.save(messages)
  }

  ensureIndex(
    app,
    messages,
    "idx_messages_conversation_position",
    "CREATE INDEX `idx_messages_conversation_position` ON `messages` (`conversation`, `position`)"
  )

  return messages
}

function migrateConversationMessages(app, messagesCollection) {
  const conversations = findCollection(app, "conversations")
  if (!conversations || !messagesCollection) {
    return
  }

  if (!hasField(conversations, "messages")) {
    return
  }

  const records = recordsOf(app, "conversations", "", "+created")
  for (let i = 0; i < records.length; i++) {
    const conversation = records[i]
    if (!conversation) continue

    const existing = app.findRecordsByFilter(
      "messages",
      'conversation = {:conversation}',
      "",
      1,
      0,
      { conversation: conversation.id }
    )
    if (existing && existing.length > 0) {
      continue
    }

    const raw = jsonValue(readField(conversation, "messages"), [])
    if (!Array.isArray(raw)) continue

    for (let position = 0; position < raw.length; position++) {
      const message = raw[position]
      if (!message || (message.role !== "user" && message.role !== "assistant")) {
        continue
      }

      const record = new Record(messagesCollection)
      record.set("conversation", conversation.id)
      record.set("role", message.role)
      record.set("content", String(message.content || ""))
      if (message.reasoning) record.set("reasoning", String(message.reasoning))
      if (message.model) record.set("model", String(message.model))
      const tools = jsonValue(message.tools, [])
      if (Array.isArray(tools) && tools.length > 0) {
        record.set("tools", tools)
      }
      record.set("position", position)
      app.save(record)
    }
  }

  conversations.fields.removeByName("messages")
  app.save(conversations)
}

function restoreConversationMessages(app) {
  const conversations = findCollection(app, "conversations")
  const messages = findCollection(app, "messages")
  if (!conversations) {
    return
  }

  if (!hasField(conversations, "messages")) {
    conversations.fields.add(new JSONField({ name: "messages" }))
    app.save(conversations)
  }

  if (!messages) {
    return
  }

  const records = recordsOf(app, "conversations", "", "+created")
  for (let i = 0; i < records.length; i++) {
    const conversation = records[i]
    if (!conversation) continue

    const rows = app.findRecordsByFilter(
      "messages",
      'conversation = {:conversation}',
      "+position,+created",
      0,
      0,
      { conversation: conversation.id }
    )
    const restored = []
    for (let j = 0; j < rows.length; j++) {
      const row = rows[j]
      const message = {
        role: row.getString("role"),
        content: row.getString("content"),
      }
      const reasoning = row.getString("reasoning")
      if (reasoning) message.reasoning = reasoning
      const model = row.getString("model")
      if (model) message.model = model
      const tools = jsonValue(row.get("tools"), [])
      if (Array.isArray(tools) && tools.length > 0) message.tools = tools
      restored.push(message)
    }
    conversation.set("messages", restored)
    app.save(conversation)
  }

  app.delete(messages)
}

// ── Board / task / version relations ───────────────────────────────

function remodelTasks(app) {
  const tasks = findCollection(app, "tasks")
  if (!tasks) {
    return
  }

  tasks.listRule = TASK_READ_RULE
  tasks.viewRule = TASK_READ_RULE
  tasks.createRule = TASK_WRITE_RULE
  tasks.updateRule = TASK_WRITE_RULE
  tasks.deleteRule = TASK_READ_RULE

  if (hasField(tasks, "author")) {
    tasks.fields.removeByName("author")
  }

  tasks.indexes = indexesWithout(tasks, "idx_tasks_author_status_order")
  ensureIndex(
    app,
    tasks,
    "idx_tasks_board_status_order",
    "CREATE INDEX `idx_tasks_board_status_order` ON `tasks` (`board`, `status`, `board_order`)"
  )
  ensureIndex(
    app,
    tasks,
    "idx_tasks_document",
    "CREATE INDEX `idx_tasks_document` ON `tasks` (`document`)"
  )
  app.save(tasks)
}

function remodelVersions(app) {
  const versions = findCollection(app, "document_versions")
  if (!versions) {
    return
  }

  versions.listRule = VERSION_RULE
  versions.viewRule = VERSION_RULE
  versions.createRule = null
  versions.updateRule = null
  versions.deleteRule = null

  if (hasField(versions, "created_by")) {
    versions.fields.removeByName("created_by")
  }

  ensureIndex(
    app,
    versions,
    "idx_document_versions_document_number",
    "CREATE INDEX `idx_document_versions_document_number` ON `document_versions` (`document`, `version_number`)"
  )
  app.save(versions)
}

function remodelConversations(app) {
  const conversations = findCollection(app, "conversations")
  if (!conversations) {
    return
  }

  conversations.listRule = AUTHOR_RULE
  conversations.viewRule = AUTHOR_RULE
  conversations.createRule = AUTHOR_RULE
  conversations.updateRule = AUTHOR_RULE
  conversations.deleteRule = AUTHOR_RULE
  app.save(conversations)

  ensureIndex(
    app,
    conversations,
    "idx_conversations_author_updated",
    "CREATE INDEX `idx_conversations_author_updated` ON `conversations` (`author`, `updated`)"
  )
}

function remodelBoards(app) {
  const boards = findCollection(app, "boards")
  if (!boards) {
    return
  }

  ensureIndex(
    app,
    boards,
    "idx_boards_author_archived",
    "CREATE INDEX `idx_boards_author_archived` ON `boards` (`author`, `archived`)"
  )
  ensureIndex(
    app,
    boards,
    "idx_boards_author_folder",
    "CREATE INDEX `idx_boards_author_folder` ON `boards` (`author`, `folder`)"
  )
  app.save(boards)

  dedupeAndIndexTokens(app, "boards", "idx_boards_share_token")
}

// ── Migration ──────────────────────────────────────────────────────

migrate(
  (app) => {
    const users = findCollection(app, "users")
    if (!users) {
      throw new Error("users collection not found")
    }

    ensureTrashFields(app, users)
    remodelVersions(app)
    remodelTasks(app)
    remodelBoards(app)
    mergeLegacyTrash(app)
    createTrashViews(app)

    const messages = ensureMessagesCollection(app)
    migrateConversationMessages(app, messages)
    remodelConversations(app)

    // Re-apply token indexes for folders as well. Documents and boards were
    // handled above; folders are updated by ensureTrashFields.
    dedupeAndIndexTokens(app, "folders", "idx_folders_share_token")

    return null
  },
  (app) => {
    // Reversal is intentionally schema-complete and copies soft-deleted rows
    // back into the legacy trash collections before the columns are removed.
    const users = findCollection(app, "users")
    if (!users) {
      throw new Error("users collection not found")
    }

    restoreLegacyTrashStorage(app)
    restoreConversationMessages(app)

    const conversations = findCollection(app, "conversations")
    if (conversations) {
      conversations.listRule = AUTHOR_RULE
      conversations.viewRule = AUTHOR_RULE
      conversations.createRule = "@request.auth.id != ''"
      conversations.updateRule = AUTHOR_RULE
      conversations.deleteRule = AUTHOR_RULE
      app.save(conversations)
      removeIndex(app, conversations, "idx_conversations_author_updated")
    }

    const versions = findCollection(app, "document_versions")
    if (versions) {
      ensureField(
        versions,
        new RelationField({
          name: "created_by",
          required: true,
          collectionId: users.id,
          cascadeDelete: false,
          maxSelect: 1,
        })
      )
      app.save(versions)
      const rows = recordsOf(app, "document_versions", "", "")
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i]
        if (!row) continue
        if (textField(row, "created_by")) continue
        try {
          const document = app.findRecordById("documents", row.getString("document"))
          row.set("created_by", document.getString("author"))
          app.save(row)
        } catch (_) {}
      }
      versions.listRule = "@request.auth.id != '' && document.author = @request.auth.id"
      versions.viewRule = "@request.auth.id != '' && document.author = @request.auth.id"
      versions.createRule = "@request.auth.id != '' && document.author = @request.auth.id"
      versions.updateRule = ""
      versions.deleteRule = "@request.auth.id != '' && document.author = @request.auth.id"
      app.save(versions)
      removeIndex(app, versions, "idx_document_versions_document_number")
    }

    const tasks = findCollection(app, "tasks")
    if (tasks) {
      ensureField(
        tasks,
        new RelationField({
          name: "author",
          required: true,
          collectionId: users.id,
          cascadeDelete: false,
          maxSelect: 1,
        })
      )
      app.save(tasks)
      const rows = recordsOf(app, "tasks", "", "")
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i]
        if (!row) continue
        if (textField(row, "author")) continue
        try {
          const board = app.findRecordById("boards", row.getString("board"))
          row.set("author", board.getString("author"))
          app.save(row)
        } catch (_) {}
      }
      tasks.listRule = AUTHOR_RULE
      tasks.viewRule = AUTHOR_RULE
      tasks.createRule = AUTHOR_RULE
      tasks.updateRule = AUTHOR_RULE
      tasks.deleteRule = AUTHOR_RULE
      app.save(tasks)
      ensureIndex(
        app,
        tasks,
        "idx_tasks_author_status_order",
        "CREATE INDEX `idx_tasks_author_status_order` ON `tasks` (`author`, `status`, `board_order`)"
      )
      removeIndex(app, tasks, "idx_tasks_document")
    }

    const boards = findCollection(app, "boards")
    if (boards) {
      removeIndex(app, boards, "idx_boards_share_token")
    }

    const folders = findCollection(app, "folders")
    if (folders) {
      // Remove indexes before the columns they reference.
      removeIndex(app, folders, "idx_folders_author_deleted_parent")
      removeIndex(app, folders, "idx_folders_share_token")
      ensureField(folders, new BoolField({ name: "published" }))
      const parent = folders.fields.getByName("parent")
      if (parent) parent.cascadeDelete = false
      if (hasField(folders, "deleted_at")) {
        folders.fields.removeByName("deleted_at")
      }
      if (hasField(folders, "deleted_by")) {
        folders.fields.removeByName("deleted_by")
      }
      folders.listRule = AUTHOR_RULE
      folders.viewRule = AUTHOR_RULE
      folders.createRule = "@request.auth.id != ''"
      folders.updateRule = "author = @request.auth.id"
      folders.deleteRule = "author = @request.auth.id"
      app.save(folders)
    }

    const documents = findCollection(app, "documents")
    if (documents) {
      // Remove indexes before the columns they reference.
      removeIndex(app, documents, "idx_documents_author_deleted_folder")
      removeIndex(app, documents, "idx_documents_author_deleted_updated")
      removeIndex(app, documents, "idx_documents_share_token")
      const folder = documents.fields.getByName("folder")
      if (folder) folder.cascadeDelete = false
      if (hasField(documents, "deleted_at")) {
        documents.fields.removeByName("deleted_at")
      }
      if (hasField(documents, "deleted_by")) {
        documents.fields.removeByName("deleted_by")
      }
      documents.listRule = AUTHOR_RULE
      documents.viewRule = AUTHOR_RULE
      documents.createRule = "@request.auth.id != ''"
      documents.updateRule = "author = @request.auth.id"
      documents.deleteRule = "author = @request.auth.id"
      app.save(documents)
    }

    return null
  }
)

// ── Down helpers ───────────────────────────────────────────────────

function restoreLegacyTrashStorage(app) {
  const foldersCollection = findCollection(app, "folders")
  const documentsCollection = findCollection(app, "documents")
  const versionsCollection = findCollection(app, "document_versions")
  if (!foldersCollection || !documentsCollection) {
    return
  }

  // Remove the read-only views before recreating the legacy base collections.
  const viewDocuments = findCollection(app, "trash_documents")
  if (viewDocuments && viewDocuments.type === "view") {
    app.delete(viewDocuments)
  }
  const viewFolders = findCollection(app, "trash_folders")
  if (viewFolders && viewFolders.type === "view") {
    app.delete(viewFolders)
  }

  const trashFolders = new Collection({
    name: "trash_folders",
    type: "base",
    listRule: AUTHOR_RULE,
    viewRule: AUTHOR_RULE,
    createRule: AUTHOR_RULE,
    updateRule: AUTHOR_RULE,
    deleteRule: AUTHOR_RULE,
  })
  trashFolders.fields.add(new TextField({ name: "name", required: true }))
  trashFolders.fields.add(
    new RelationField({
      name: "author",
      required: true,
      collectionId: findCollection(app, "users").id,
      cascadeDelete: false,
      maxSelect: 1,
    })
  )
  trashFolders.fields.add(new TextField({ name: "color" }))
  trashFolders.fields.add(new TextField({ name: "original_folder_id" }))
  trashFolders.fields.add(
    new TextField({ name: "original_parent_folder_id" })
  )
  trashFolders.fields.add(
    new RelationField({
      name: "deleted_by",
      collectionId: findCollection(app, "users").id,
      cascadeDelete: false,
      maxSelect: 1,
    })
  )
  trashFolders.fields.add(new BoolField({ name: "deleted" }))
  trashFolders.fields.add(new DateField({ name: "deleted_at" }))
  trashFolders.fields.add(new BoolField({ name: "published" }))
  trashFolders.fields.add(
    new AutodateField({ name: "created", onCreate: true, onUpdate: false })
  )
  trashFolders.fields.add(
    new AutodateField({ name: "updated", onCreate: true, onUpdate: true })
  )
  app.save(trashFolders)
  trashFolders.fields.add(
    new RelationField({
      name: "parent",
      collectionId: trashFolders.id,
      cascadeDelete: false,
      maxSelect: 1,
    })
  )
  app.save(trashFolders)

  const trashDocuments = new Collection({
    name: "trash_documents",
    type: "base",
    listRule: AUTHOR_RULE,
    viewRule: AUTHOR_RULE,
    createRule: AUTHOR_RULE,
    updateRule: AUTHOR_RULE,
    deleteRule: AUTHOR_RULE,
  })
  trashDocuments.fields.add(new TextField({ name: "title", required: true }))
  trashDocuments.fields.add(new TextField({ name: "slug", required: true }))
  trashDocuments.fields.add(
    new EditorField({ name: "content", maxSize: 100 * 1024 * 1024 })
  )
  trashDocuments.fields.add(
    new FileField({
      name: "attachments",
      maxSelect: 20,
      maxSize: 50 * 1024 * 1024,
      protected: true,
    })
  )
  trashDocuments.fields.add(new JSONField({ name: "tags" }))
  trashDocuments.fields.add(new BoolField({ name: "published" }))
  trashDocuments.fields.add(
    new RelationField({
      name: "author",
      required: true,
      collectionId: findCollection(app, "users").id,
      cascadeDelete: false,
      maxSelect: 1,
    })
  )
  trashDocuments.fields.add(
    new NumberField({ name: "word_count", min: 0 })
  )
  trashDocuments.fields.add(
    new NumberField({ name: "reading_time", min: 0 })
  )
  trashDocuments.fields.add(
    new RelationField({
      name: "folder",
      collectionId: trashFolders.id,
      cascadeDelete: false,
      maxSelect: 1,
    })
  )
  trashDocuments.fields.add(new TextField({ name: "original_document_id" }))
  trashDocuments.fields.add(new TextField({ name: "original_folder_id" }))
  trashDocuments.fields.add(
    new RelationField({
      name: "deleted_by",
      collectionId: findCollection(app, "users").id,
      cascadeDelete: false,
      maxSelect: 1,
    })
  )
  trashDocuments.fields.add(new BoolField({ name: "deleted" }))
  trashDocuments.fields.add(new DateField({ name: "deleted_at" }))
  trashDocuments.fields.add(
    new AutodateField({ name: "created", onCreate: true, onUpdate: false })
  )
  trashDocuments.fields.add(
    new AutodateField({ name: "updated", onCreate: true, onUpdate: true })
  )
  app.save(trashDocuments)

  const trashVersions = new Collection({
    name: "trash_document_versions",
    type: "base",
    listRule: AUTHOR_RULE,
    viewRule: AUTHOR_RULE,
    createRule: AUTHOR_RULE,
    updateRule: "",
    deleteRule: AUTHOR_RULE,
  })
  trashVersions.fields.add(
    new RelationField({
      name: "trash_document",
      required: true,
      collectionId: trashDocuments.id,
      cascadeDelete: true,
      maxSelect: 1,
    })
  )
  trashVersions.fields.add(new TextField({ name: "original_version_id" }))
  trashVersions.fields.add(new TextField({ name: "original_document_id" }))
  trashVersions.fields.add(
    new EditorField({ name: "content", maxSize: 100 * 1024 * 1024 })
  )
  trashVersions.fields.add(
    new NumberField({ name: "version_number", required: true })
  )
  trashVersions.fields.add(new TextField({ name: "change_summary" }))
  trashVersions.fields.add(
    new RelationField({
      name: "created_by",
      required: true,
      collectionId: findCollection(app, "users").id,
      cascadeDelete: false,
      maxSelect: 1,
    })
  )
  trashVersions.fields.add(
    new RelationField({
      name: "author",
      required: true,
      collectionId: findCollection(app, "users").id,
      cascadeDelete: false,
      maxSelect: 1,
    })
  )
  trashVersions.fields.add(new DateField({ name: "deleted_at" }))
  trashVersions.fields.add(new DateField({ name: "source_created_at" }))
  trashVersions.fields.add(
    new RelationField({
      name: "source_version_record",
      collectionId: versionsCollection ? versionsCollection.id : "",
      cascadeDelete: false,
      maxSelect: 1,
    })
  )
  trashVersions.fields.add(
    new AutodateField({ name: "created", onCreate: true, onUpdate: false })
  )
  app.save(trashVersions)

  const folderMap = {}
  const trashFolderRecords = recordsOf(
    app,
    "folders",
    "deleted_at != ''",
    "+created"
  )
  for (let i = 0; i < trashFolderRecords.length; i++) {
    const source = trashFolderRecords[i]
    if (!source) continue
    const record = new Record(trashFolders)
    const originalParentId = textField(source, "parent")
    record.set("name", textField(source, "name") || "Untitled folder")
    record.set("author", textField(source, "author"))
    record.set("color", textField(source, "color"))
    record.set("original_folder_id", source.id)
    record.set("original_parent_folder_id", originalParentId)
    record.set("deleted_by", textField(source, "deleted_by"))
    record.set("deleted", true)
    record.set("deleted_at", textField(source, "deleted_at"))
    record.set("published", false)
    if (originalParentId && folderMap[originalParentId]) {
      record.set("parent", folderMap[originalParentId])
    }
    app.save(record)
    folderMap[source.id] = record.id
  }

  // Parents can appear after their children in the legacy ordering; link them
  // in a second pass now that every source id has a trash id.
  for (let i = 0; i < trashFolderRecords.length; i++) {
    const source = trashFolderRecords[i]
    if (!source) continue
    const trashId = folderMap[source.id]
    if (!trashId) continue
    const parentId = textField(source, "original_parent_folder_id")
    if (!parentId || !folderMap[parentId]) continue
    try {
      const record = app.findRecordById("trash_folders", trashId)
      record.set("parent", folderMap[parentId])
      app.save(record)
    } catch (_) {}
  }

  const documentMap = {}
  const trashDocumentRecords = recordsOf(
    app,
    "documents",
    "deleted_at != ''",
    "+created"
  )
  for (let i = 0; i < trashDocumentRecords.length; i++) {
    const source = trashDocumentRecords[i]
    if (!source) continue
    const record = new Record(trashDocuments)
    record.set("title", textField(source, "title") || "Untitled")
    record.set("slug", textField(source, "slug"))
    record.set("content", textField(source, "content"))
    record.set("tags", jsonValue(readField(source, "tags"), []))
    record.set("published", false)
    record.set("author", textField(source, "author"))
    record.set(
      "word_count",
      Number(readField(source, "word_count") || 0)
    )
    record.set(
      "reading_time",
      Number(readField(source, "reading_time") || 0)
    )
    const sourceFolder = textField(source, "folder")
    if (sourceFolder && folderMap[sourceFolder]) {
      record.set("folder", folderMap[sourceFolder])
    }
    record.set("original_document_id", source.id)
    record.set("original_folder_id", sourceFolder)
    record.set("deleted_by", textField(source, "deleted_by"))
    record.set("deleted", true)
    record.set("deleted_at", textField(source, "deleted_at"))
    const filenames = fileFieldNames(source, "attachments")
    withClonedFiles(app, source, filenames, (files) => {
      record.set("attachments", files)
      app.save(record)
    })
    documentMap[source.id] = record.id
  }

  if (versionsCollection) {
    const versionRecords = recordsOf(
      app,
      "document_versions",
      "",
      "+created"
    )
    for (let i = 0; i < versionRecords.length; i++) {
      const source = versionRecords[i]
      if (!source) continue
      const documentId = textField(source, "document")
      const trashDocumentId = documentMap[documentId]
      if (!trashDocumentId) continue
      let author = ""
      try {
        author = app.findRecordById("documents", documentId).getString("author")
      } catch (_) {}
      const record = new Record(trashVersions)
      record.set("trash_document", trashDocumentId)
      record.set("original_version_id", source.id)
      record.set("original_document_id", documentId)
      record.set("content", textField(source, "content"))
      record.set("version_number", Number(readField(source, "version_number") || 1))
      record.set("change_summary", textField(source, "change_summary"))
      record.set("created_by", author)
      record.set("author", author)
      record.set("deleted_at", textField(source, "deleted_at"))
      record.set("source_created_at", textField(source, "source_created_at"))
      record.set("source_version_record", source.id)
      app.save(record)
    }
  }

  // Remove the soft-deleted live rows now that they are in legacy trash.
  for (let i = 0; i < trashDocumentRecords.length; i++) {
    const source = trashDocumentRecords[i]
    if (!source) continue
    try {
      app.delete(source)
    } catch (_) {}
  }
  for (let i = 0; i < trashFolderRecords.length; i++) {
    const source = trashFolderRecords[i]
    if (!source) continue
    try {
      app.delete(source)
    } catch (_) {}
  }
}
