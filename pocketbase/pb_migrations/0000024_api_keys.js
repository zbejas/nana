/// <reference path="../pb_data/types.d.ts" />

// Long-lived account API keys for the typed workspace API and MCP.
//
// Only a SHA-256 hash of the secret is stored. The plaintext key is shown once
// when it is created. All access goes through Bun: the collection has no public
// API rules, so even an owner token cannot read hashes or forge a key record.
//
// `access` limits a key to reads, and `scope` limits it to the workspace, the
// workspace root only, or a set of folder subtrees. Folder scope is enforced by
// the workspace services, not by PocketBase rules, because the services are the
// only consumer of this collection.

const API_KEY_HASH_INDEX = "idx_api_keys_hash"
const API_KEY_AUTHOR_INDEX = "idx_api_keys_author"
const API_KEY_PREFIX_INDEX = "idx_api_keys_prefix"

function findCollection(app, name) {
  try {
    return app.findCollectionByNameOrId(name)
  } catch (_) {
    return null
  }
}

migrate(
  (app) => {
    if (findCollection(app, "api_keys")) {
      return null
    }

    const users = app.findCollectionByNameOrId("users")
    const folders = app.findCollectionByNameOrId("folders")

    const apiKeys = new Collection({
      name: "api_keys",
      type: "base",
      // Credential metadata is server-managed. Bun reads and writes it with the
      // cached superuser token after verifying the caller; the public API never
      // talks to this collection directly.
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      indexes: [
        `CREATE UNIQUE INDEX \`${API_KEY_HASH_INDEX}\` ON \`api_keys\` (\`key_hash\`)`,
        `CREATE INDEX \`${API_KEY_AUTHOR_INDEX}\` ON \`api_keys\` (\`author\`)`,
        `CREATE INDEX \`${API_KEY_PREFIX_INDEX}\` ON \`api_keys\` (\`key_prefix\`)`,
      ],
    })

    apiKeys.fields.add(
      new TextField({
        name: "name",
        required: true,
        max: 80,
      })
    )
    apiKeys.fields.add(
      new TextField({
        name: "key_prefix",
        required: true,
        max: 24,
      })
    )
    apiKeys.fields.add(
      new TextField({
        name: "key_hash",
        required: true,
        max: 128,
      })
    )
    apiKeys.fields.add(
      new SelectField({
        name: "access",
        required: true,
        maxSelect: 1,
        values: ["read", "write"],
      })
    )
    apiKeys.fields.add(
      new SelectField({
        name: "scope",
        required: true,
        maxSelect: 1,
        values: ["workspace", "root", "folders"],
      })
    )
    apiKeys.fields.add(
      new RelationField({
        name: "folders",
        required: false,
        collectionId: folders.id,
        cascadeDelete: false,
        maxSelect: 20,
      })
    )
    apiKeys.fields.add(new DateField({ name: "last_used_at", required: false }))
    apiKeys.fields.add(
      new RelationField({
        name: "author",
        required: true,
        collectionId: users.id,
        cascadeDelete: true,
        maxSelect: 1,
      })
    )
    apiKeys.fields.add(
      new AutodateField({ name: "created", onCreate: true, onUpdate: false })
    )
    apiKeys.fields.add(
      new AutodateField({ name: "updated", onCreate: true, onUpdate: true })
    )

    app.save(apiKeys)
    return null
  },
  (app) => {
    const apiKeys = findCollection(app, "api_keys")
    if (!apiKeys) {
      return null
    }

    app.delete(apiKeys)
    return null
  }
)
