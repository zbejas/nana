/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    const documentVersionsCollection = app.findCollectionByNameOrId("document_versions")
    const existingField = documentVersionsCollection?.fields?.getByName("source_created_at")

    if (!documentVersionsCollection) {
      throw new Error("document_versions collection not found")
    }

    if (!existingField) {
      documentVersionsCollection.fields.add(new DateField({ name: "source_created_at" }))
      app.save(documentVersionsCollection)
    }

    const versions = app.findAllRecords("document_versions")
    for (const version of versions) {
      if (!version || version.get("source_created_at")) {
        continue
      }

      version.set("source_created_at", version.get("created") || null)
      app.saveNoValidate(version)
    }

    return null
  },
  (app) => {
    const documentVersionsCollection = app.findCollectionByNameOrId("document_versions")
    const existingField = documentVersionsCollection?.fields?.getByName("source_created_at")

    if (!documentVersionsCollection || !existingField) {
      return null
    }

    documentVersionsCollection.fields.removeByName("source_created_at")
    app.save(documentVersionsCollection)

    return null
  }
)