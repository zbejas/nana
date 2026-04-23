/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const usersCollection = app.findCollectionByNameOrId("users")
  const foldersCollection = app.findCollectionByNameOrId("folders")

  const maxAttachmentSizeMB = 50
  const maxAttachmentSize = maxAttachmentSizeMB * 1024 * 1024
  const maxAttachments = 20

  const trashFolders = new Collection({
    name: "trash_folders",
    type: "base",
    listRule: "@request.auth.id != '' && author = @request.auth.id",
    viewRule: "@request.auth.id != '' && author = @request.auth.id",
    createRule: "@request.auth.id != '' && author = @request.auth.id",
    updateRule: "@request.auth.id != '' && author = @request.auth.id",
    deleteRule: "@request.auth.id != '' && author = @request.auth.id",
  })

  trashFolders.fields.add(new TextField({ name: "name", required: true }))
  trashFolders.fields.add(new RelationField({
    name: "author",
    required: true,
    collectionId: usersCollection.id,
    cascadeDelete: false,
    maxSelect: 1,
  }))
  trashFolders.fields.add(new TextField({ name: "color" }))
  trashFolders.fields.add(new TextField({ name: "original_folder_id" }))
  trashFolders.fields.add(new TextField({ name: "original_parent_folder_id" }))
  trashFolders.fields.add(new RelationField({
    name: "deleted_by",
    collectionId: usersCollection.id,
    cascadeDelete: false,
    maxSelect: 1,
  }))
  trashFolders.fields.add(new BoolField({ name: "deleted" }))
  trashFolders.fields.add(new DateField({ name: "deleted_at" }))
  trashFolders.fields.add(new BoolField({ name: "published" }))
  trashFolders.fields.add(new AutodateField({
    name: "created",
    onCreate: true,
    onUpdate: false,
  }))
  trashFolders.fields.add(new AutodateField({
    name: "updated",
    onCreate: true,
    onUpdate: true,
  }))

  app.save(trashFolders)

  trashFolders.fields.add(new RelationField({
    name: "parent",
    collectionId: trashFolders.id,
    cascadeDelete: false,
    maxSelect: 1,
  }))

  app.save(trashFolders)

  const trashDocuments = new Collection({
    name: "trash_documents",
    type: "base",
    listRule: "@request.auth.id != '' && author = @request.auth.id",
    viewRule: "@request.auth.id != '' && author = @request.auth.id",
    createRule: "@request.auth.id != '' && author = @request.auth.id",
    updateRule: "@request.auth.id != '' && author = @request.auth.id",
    deleteRule: "@request.auth.id != '' && author = @request.auth.id",
  })

  trashDocuments.fields.add(new TextField({ name: "title", required: true }))
  trashDocuments.fields.add(new TextField({ name: "slug", required: true }))
  trashDocuments.fields.add(new EditorField({ name: "content", required: false }))
  trashDocuments.fields.add(new FileField({
    name: "attachments",
    maxSelect: maxAttachments,
    maxSize: maxAttachmentSize,
    mimeTypes: [],
    thumbs: ["100x100", "300x0", "800x0", "0x600"],
    protected: true,
  }))
  trashDocuments.fields.add(new JSONField({ name: "tags" }))
  trashDocuments.fields.add(new BoolField({ name: "published" }))
  trashDocuments.fields.add(new RelationField({
    name: "author",
    required: true,
    collectionId: usersCollection.id,
    cascadeDelete: false,
    maxSelect: 1,
  }))
  trashDocuments.fields.add(new NumberField({ name: "word_count", required: false, min: 0 }))
  trashDocuments.fields.add(new NumberField({ name: "reading_time", required: false, min: 0 }))
  trashDocuments.fields.add(new RelationField({
    name: "folder",
    collectionId: trashFolders.id,
    cascadeDelete: false,
    maxSelect: 1,
  }))
  trashDocuments.fields.add(new TextField({ name: "original_document_id" }))
  trashDocuments.fields.add(new TextField({ name: "original_folder_id" }))
  trashDocuments.fields.add(new RelationField({
    name: "deleted_by",
    collectionId: usersCollection.id,
    cascadeDelete: false,
    maxSelect: 1,
  }))
  trashDocuments.fields.add(new BoolField({ name: "deleted" }))
  trashDocuments.fields.add(new DateField({ name: "deleted_at" }))
  trashDocuments.fields.add(new AutodateField({
    name: "created",
    onCreate: true,
    onUpdate: false,
  }))
  trashDocuments.fields.add(new AutodateField({
    name: "updated",
    onCreate: true,
    onUpdate: true,
  }))

  app.save(trashDocuments)

  const activeDocumentVersions = app.findCollectionByNameOrId("document_versions")

  const trashDocumentVersions = new Collection({
    name: "trash_document_versions",
    type: "base",
    listRule: "@request.auth.id != '' && author = @request.auth.id",
    viewRule: "@request.auth.id != '' && author = @request.auth.id",
    createRule: "@request.auth.id != '' && author = @request.auth.id",
    updateRule: "",
    deleteRule: "@request.auth.id != '' && author = @request.auth.id",
  })

  trashDocumentVersions.fields.add(new RelationField({
    name: "trash_document",
    required: true,
    collectionId: trashDocuments.id,
    cascadeDelete: true,
    maxSelect: 1,
  }))
  trashDocumentVersions.fields.add(new TextField({ name: "original_version_id" }))
  trashDocumentVersions.fields.add(new TextField({ name: "original_document_id" }))
  trashDocumentVersions.fields.add(new EditorField({ name: "content", required: false }))
  trashDocumentVersions.fields.add(new NumberField({ name: "version_number", required: true }))
  trashDocumentVersions.fields.add(new TextField({ name: "change_summary" }))
  trashDocumentVersions.fields.add(new RelationField({
    name: "created_by",
    required: true,
    collectionId: usersCollection.id,
    cascadeDelete: false,
    maxSelect: 1,
  }))
  trashDocumentVersions.fields.add(new RelationField({
    name: "author",
    required: true,
    collectionId: usersCollection.id,
    cascadeDelete: false,
    maxSelect: 1,
  }))
  trashDocumentVersions.fields.add(new DateField({ name: "deleted_at" }))
  trashDocumentVersions.fields.add(new DateField({ name: "source_created_at" }))
  trashDocumentVersions.fields.add(new RelationField({
    name: "source_version_record",
    collectionId: activeDocumentVersions.id,
    cascadeDelete: false,
    maxSelect: 1,
  }))
  trashDocumentVersions.fields.add(new AutodateField({
    name: "created",
    onCreate: true,
    onUpdate: false,
  }))

  return app.save(trashDocumentVersions)
}, (app) => {
  const trashDocumentVersions = app.findCollectionByNameOrId("trash_document_versions")
  app.delete(trashDocumentVersions)

  const trashDocuments = app.findCollectionByNameOrId("trash_documents")
  app.delete(trashDocuments)

  const trashFolders = app.findCollectionByNameOrId("trash_folders")
  return app.delete(trashFolders)
})
