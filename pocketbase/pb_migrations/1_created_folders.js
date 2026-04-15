/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const usersCollection = app.findCollectionByNameOrId("users")

  const foldersCollection = new Collection({
    name: "folders",
    type: "base",
    listRule: "@request.auth.id != '' && (author = @request.auth.id || published = true)",
    viewRule: "author = @request.auth.id || published = true",
    createRule: "@request.auth.id != ''",
    updateRule: "author = @request.auth.id",
    deleteRule: "author = @request.auth.id",
  })
  
  foldersCollection.fields.add(new TextField({ name: "name", required: true }))
  foldersCollection.fields.add(new RelationField({
    name: "author",
    required: true,
    collectionId: usersCollection.id,
    cascadeDelete: false,
    maxSelect: 1,
  }))
  foldersCollection.fields.add(new TextField({ name: "color" }))
  foldersCollection.fields.add(new BoolField({ name: "published" }))
  foldersCollection.fields.add(new AutodateField({
    name: "created",
    onCreate: true,
    onUpdate: false,
  }))
  foldersCollection.fields.add(new AutodateField({
    name: "updated",
    onCreate: true,
    onUpdate: true,
  }))

  app.save(foldersCollection)

  // Now add self-referencing parent field
  foldersCollection.fields.add(new RelationField({
    name: "parent",
    collectionId: foldersCollection.id,
    cascadeDelete: false,
    maxSelect: 1,
  }))

  app.save(foldersCollection)

  // Max attachment size default 50MB
  const maxAttachmentSizeMB = 50
  const maxAttachmentSize = maxAttachmentSizeMB * 1024 * 1024 // Convert MB to bytes

  // Max number of attachments default 20
  const maxAttachments = 20

  const documentsCollection = new Collection({
    name: "documents",
    type: "base",
    listRule: "@request.auth.id != '' && (author = @request.auth.id || published = true)",
    viewRule: "author = @request.auth.id || published = true",
    createRule: "@request.auth.id != ''",
    updateRule: "author = @request.auth.id",
    deleteRule: "author = @request.auth.id",
  })

  documentsCollection.fields.add(new TextField({ name: "title", required: true }))
  documentsCollection.fields.add(new TextField({ name: "slug", required: true }))
  documentsCollection.fields.add(new EditorField({ name: "content", required: false }))
  documentsCollection.fields.add(new FileField({
    name: "attachments",
    maxSelect: maxAttachments,
    maxSize: maxAttachmentSize,
    mimeTypes: [],
    thumbs: [
      "100x100",
      "300x0",
      "800x0",
      "0x600"
    ],
    protected: true
  }))
  documentsCollection.fields.add(new JSONField({ name: "tags" }))
  documentsCollection.fields.add(new BoolField({ name: "published" }))
  documentsCollection.fields.add(new RelationField({
    name: "author",
    required: true,
    collectionId: usersCollection.id,
    cascadeDelete: false,
    maxSelect: 1,
  }))
  documentsCollection.fields.add(new NumberField({ name: "word_count", required: false, min: 0 }))
  documentsCollection.fields.add(new NumberField({ name: "reading_time", required: false, min: 0 }))
  documentsCollection.fields.add(new RelationField({
    name: "folder",
    collectionId: foldersCollection.id,
    cascadeDelete: false,
    maxSelect: 1,
  }))
  documentsCollection.fields.add(new AutodateField({
    name: "created",
    onCreate: true,
    onUpdate: false,
  }))
  documentsCollection.fields.add(new AutodateField({
    name: "updated",
    onCreate: true,
    onUpdate: true,
  }))

  app.save(documentsCollection)

  const documentVersionsCollection = new Collection({
    name: "document_versions",
    type: "base",
    listRule: "@request.auth.id != '' && document.author = @request.auth.id",
    viewRule: "@request.auth.id != '' && document.author = @request.auth.id",
    createRule: "@request.auth.id != '' && document.author = @request.auth.id",
    updateRule: "",
    deleteRule: "@request.auth.id != '' && document.author = @request.auth.id",
  })

  documentVersionsCollection.fields.add(new RelationField({
    name: "document",
    required: true,
    collectionId: documentsCollection.id,
    cascadeDelete: true,
    maxSelect: 1,
  }))
  documentVersionsCollection.fields.add(new EditorField({ name: "content", required: false }))
  documentVersionsCollection.fields.add(new NumberField({ name: "version_number", required: true }))
  documentVersionsCollection.fields.add(new TextField({ name: "change_summary" }))
  documentVersionsCollection.fields.add(new RelationField({
    name: "created_by",
    required: true,
    collectionId: usersCollection.id,
    cascadeDelete: false,
    maxSelect: 1,
  }))
  documentVersionsCollection.fields.add(new AutodateField({
    name: "created",
    onCreate: true,
    onUpdate: false,
  }))

  return app.save(documentVersionsCollection)
}, (app) => {
  const documentVersionsCollection = app.findCollectionByNameOrId("document_versions")
  app.delete(documentVersionsCollection)

  const documentsCollection = app.findCollectionByNameOrId("documents")
  app.delete(documentsCollection)

  const foldersCollection = app.findCollectionByNameOrId("folders")
  return app.delete(foldersCollection)
})
