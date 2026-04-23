/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    const documentsCollection = app.findCollectionByNameOrId("documents")
    const trashDocumentsCollection = app.findCollectionByNameOrId("trash_documents")
    const documentAttachmentsField = documentsCollection?.fields?.getByName("attachments")
    const trashAttachmentsField = trashDocumentsCollection?.fields?.getByName("attachments")

    if (!documentsCollection || !trashDocumentsCollection || !documentAttachmentsField || !trashAttachmentsField) {
      throw new Error("Document attachments fields not found")
    }

    trashAttachmentsField.maxSize = documentAttachmentsField.maxSize
    trashAttachmentsField.maxSelect = documentAttachmentsField.maxSelect

    app.save(trashDocumentsCollection)

    return null
  },
  () => {
    return null
  }
)