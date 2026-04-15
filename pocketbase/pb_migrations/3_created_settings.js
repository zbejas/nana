/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = new Collection({
    name: "settings",
    type: "base",
    // Only admins can access settings
    listRule: "@request.auth.admin = true",
    viewRule: "@request.auth.admin = true",
    createRule: "@request.auth.admin = true",
    updateRule: "@request.auth.admin = true",
    deleteRule: "@request.auth.admin = true",
  })

  // Key-value store for application settings
  collection.fields.add(new TextField({
    name: "key",
    required: true,
    unique: true, // Ensure unique keys
  }))
  collection.fields.add(new JSONField({
    name: "value",
    required: false,
  }))
  collection.fields.add(new TextField({
    name: "description",
    required: false,
  }))
  collection.fields.add(new AutodateField({
    name: "created",
    onCreate: true,
  }))
  collection.fields.add(new AutodateField({
    name: "updated",
    onCreate: true,
    onUpdate: true,
  }))

  // Add unique index on key field
  collection.indexes = [
    'CREATE UNIQUE INDEX `idx_settings_key` ON `settings` (`key`)'
  ]

  app.save(collection)

  // Create default settings record for site_url
  const settingsCollection = app.findCollectionByNameOrId("settings")
  const record = new Record(settingsCollection, {
    key: "site_url",
    value: {
      url: "",
    },
    description: "Base URL for the Nana instance (e.g., https://nana.example.com or nana.example.com)"
  })
  app.save(record)

  return null
}, (app) => {
  const collection = app.findCollectionByNameOrId("settings")
  app.delete(collection)
  return null
})
