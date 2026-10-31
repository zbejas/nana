/// <reference path="../pb_data/types.d.ts" />

// User-to-user sharing and comments.
//
// - `shares` is the owner-managed grant: one direct grant per resource/user.
// - `access_grants` materializes inherited folder grants so PocketBase rules can
//   resolve a document/board/folder without recursive lookups.
// - `comments` is internal storage; the custom route layer enforces target
//   access and moderation.
//
// Resource read rules accept direct shares and inherited grants. Update rules
// are intentionally broader than "edit" because the request guards enforce the
// exact permission level and owner-only fields.

const AUTHOR_RULE = "@request.auth.id != '' && author = @request.auth.id"
const VISIBLE_RULE =
  "@request.auth.id != '' && author = @request.auth.id && deleted_at = ''"
const TASK_READ_RULE = "@request.auth.id != '' && board.author = @request.auth.id"
const TASK_WRITE_RULE =
  "@request.auth.id != '' && board.author = @request.auth.id && board.archived = false"

const DOCUMENT_SHARED_READ =
  "@request.auth.id != '' && deleted_at = '' && (author = @request.auth.id || shares_via_document.user ?= @request.auth.id || (is_private = false && access_grants_via_document.user ?= @request.auth.id))"
const FOLDER_SHARED_READ =
  "@request.auth.id != '' && deleted_at = '' && (author = @request.auth.id || shares_via_folder.user ?= @request.auth.id || (is_private = false && access_grants_via_folder.user ?= @request.auth.id))"
const BOARD_SHARED_READ =
  "@request.auth.id != '' && (author = @request.auth.id || shares_via_board.user ?= @request.auth.id || (is_private = false && access_grants_via_board.user ?= @request.auth.id))"
const TASK_SHARED_READ =
  "@request.auth.id != '' && (board.author = @request.auth.id || board.shares_via_board.user ?= @request.auth.id || (board.is_private = false && board.access_grants_via_board.user ?= @request.auth.id))"
const TASK_SHARED_WRITE =
  "@request.auth.id != '' && board.archived = false && (board.author = @request.auth.id || board.shares_via_board.user ?= @request.auth.id || (board.is_private = false && board.access_grants_via_board.user ?= @request.auth.id))"

const SHARE_RULE =
  "@request.auth.id != '' && (shared_by = @request.auth.id || user = @request.auth.id)"

function findCollection(app, name) {
  try {
    return app.findCollectionByNameOrId(name)
  } catch (_) {
    return null
  }
}

function addRelation(collection, fieldName, targetId, required, cascade) {
  collection.fields.add(
    new RelationField({
      name: fieldName,
      required: required === true,
      collectionId: targetId,
      cascadeDelete: cascade === true,
      maxSelect: 1,
    })
  )
}

function ensureSharesCollection(app, users, documents, folders, boards) {
  let shares = findCollection(app, "shares")
  if (!shares) {
    shares = new Collection({
      name: "shares",
      type: "base",
      listRule: SHARE_RULE,
      viewRule: SHARE_RULE,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      indexes: [
        "CREATE UNIQUE INDEX `idx_shares_document_user` ON `shares` (`document`, `user`) WHERE `document` != ''",
        "CREATE UNIQUE INDEX `idx_shares_folder_user` ON `shares` (`folder`, `user`) WHERE `folder` != ''",
        "CREATE UNIQUE INDEX `idx_shares_board_user` ON `shares` (`board`, `user`) WHERE `board` != ''",
        "CREATE INDEX `idx_shares_user` ON `shares` (`user`)",
        "CREATE INDEX `idx_shares_shared_by` ON `shares` (`shared_by`)",
      ],
    })
    addRelation(shares, "document", documents.id, false, true)
    addRelation(shares, "folder", folders.id, false, true)
    addRelation(shares, "board", boards.id, false, true)
    addRelation(shares, "user", users.id, true, true)
    addRelation(shares, "shared_by", users.id, true, false)
    shares.fields.add(
      new SelectField({
        name: "permission",
        required: true,
        maxSelect: 1,
        values: ["view", "comment", "edit"],
      })
    )
    shares.fields.add(
      new NumberField({ name: "level", required: true, min: 1, max: 3 })
    )
    shares.fields.add(
      new AutodateField({ name: "created", onCreate: true, onUpdate: false })
    )
    shares.fields.add(
      new AutodateField({ name: "updated", onCreate: true, onUpdate: true })
    )
    app.save(shares)
  }
  return shares
}

function ensureAccessGrantsCollection(app, users, documents, folders, boards) {
  let grants = findCollection(app, "access_grants")
  if (!grants) {
    grants = new Collection({
      name: "access_grants",
      type: "base",
      listRule: "@request.auth.id != '' && user = @request.auth.id",
      viewRule: "@request.auth.id != '' && user = @request.auth.id",
      createRule: null,
      updateRule: null,
      deleteRule: null,
      indexes: [
        "CREATE UNIQUE INDEX `idx_access_grants_document_user` ON `access_grants` (`document`, `user`) WHERE `document` != ''",
        "CREATE UNIQUE INDEX `idx_access_grants_folder_user` ON `access_grants` (`folder`, `user`) WHERE `folder` != ''",
        "CREATE UNIQUE INDEX `idx_access_grants_board_user` ON `access_grants` (`board`, `user`) WHERE `board` != ''",
        "CREATE INDEX `idx_access_grants_user` ON `access_grants` (`user`)",
      ],
    })
    addRelation(grants, "document", documents.id, false, true)
    addRelation(grants, "folder", folders.id, false, true)
    addRelation(grants, "board", boards.id, false, true)
    addRelation(grants, "user", users.id, true, true)
    grants.fields.add(
      new SelectField({
        name: "permission",
        required: true,
        maxSelect: 1,
        values: ["view", "comment", "edit"],
      })
    )
    grants.fields.add(
      new NumberField({ name: "level", required: true, min: 1, max: 3 })
    )
    grants.fields.add(
      new AutodateField({ name: "created", onCreate: true, onUpdate: false })
    )
    grants.fields.add(
      new AutodateField({ name: "updated", onCreate: true, onUpdate: true })
    )
    app.save(grants)
  }
  return grants
}

function ensureCommentsCollection(app, users, documents, boards) {
  let comments = findCollection(app, "comments")
  if (!comments) {
    comments = new Collection({
      name: "comments",
      type: "base",
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      indexes: [
        "CREATE INDEX `idx_comments_document_created` ON `comments` (`document`, `created`)",
        "CREATE INDEX `idx_comments_board_created` ON `comments` (`board`, `created`)",
        "CREATE INDEX `idx_comments_author` ON `comments` (`author`)",
      ],
    })
    addRelation(comments, "document", documents.id, false, true)
    addRelation(comments, "board", boards.id, false, true)
    addRelation(comments, "author", users.id, true, false)
    comments.fields.add(
      new TextField({ name: "body", required: true, max: 10000 })
    )
    comments.fields.add(
      new AutodateField({ name: "created", onCreate: true, onUpdate: false })
    )
    comments.fields.add(
      new AutodateField({ name: "updated", onCreate: true, onUpdate: true })
    )
    app.save(comments)
  }
  return comments
}

migrate(
  (app) => {
    const users = findCollection(app, "users")
    const documents = findCollection(app, "documents")
    const folders = findCollection(app, "folders")
    const boards = findCollection(app, "boards")
    const tasks = findCollection(app, "tasks")
    if (!users || !documents || !folders || !boards || !tasks) {
      throw new Error("Sharing requires users, documents, folders, boards, and tasks")
    }

    ensureSharesCollection(app, users, documents, folders, boards)
    ensureAccessGrantsCollection(app, users, documents, folders, boards)
    ensureCommentsCollection(app, users, documents, boards)

    documents.listRule = DOCUMENT_SHARED_READ
    documents.viewRule = DOCUMENT_SHARED_READ
    documents.updateRule = DOCUMENT_SHARED_READ
    app.save(documents)

    folders.listRule = FOLDER_SHARED_READ
    folders.viewRule = FOLDER_SHARED_READ
    folders.updateRule = FOLDER_SHARED_READ
    app.save(folders)

    boards.listRule = BOARD_SHARED_READ
    boards.viewRule = BOARD_SHARED_READ
    boards.updateRule = BOARD_SHARED_READ
    app.save(boards)

    tasks.listRule = TASK_SHARED_READ
    tasks.viewRule = TASK_SHARED_READ
    tasks.deleteRule = TASK_SHARED_READ
    tasks.createRule = TASK_SHARED_WRITE
    tasks.updateRule = TASK_SHARED_WRITE
    app.save(tasks)

    return null
  },
  (app) => {
    const documents = findCollection(app, "documents")
    const folders = findCollection(app, "folders")
    const boards = findCollection(app, "boards")
    const tasks = findCollection(app, "tasks")

    if (documents) {
      documents.listRule = VISIBLE_RULE
      documents.viewRule = VISIBLE_RULE
      documents.updateRule = VISIBLE_RULE
      app.save(documents)
    }
    if (folders) {
      folders.listRule = VISIBLE_RULE
      folders.viewRule = VISIBLE_RULE
      folders.updateRule = VISIBLE_RULE
      app.save(folders)
    }
    if (boards) {
      boards.listRule = AUTHOR_RULE
      boards.viewRule = AUTHOR_RULE
      boards.updateRule = AUTHOR_RULE
      boards.deleteRule =
        "@request.auth.id != '' && author = @request.auth.id && archived = true"
      app.save(boards)
    }
    if (tasks) {
      tasks.listRule = TASK_READ_RULE
      tasks.viewRule = TASK_READ_RULE
      tasks.deleteRule = TASK_READ_RULE
      tasks.createRule = TASK_WRITE_RULE
      tasks.updateRule = TASK_WRITE_RULE
      app.save(tasks)
    }

    for (const name of ["comments", "access_grants", "shares"]) {
      const collection = findCollection(app, name)
      if (collection) app.delete(collection)
    }

    return null
  }
)
