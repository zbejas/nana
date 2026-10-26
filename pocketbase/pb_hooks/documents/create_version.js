/// <reference path="../../pb_data/types.d.ts" />

// Hook to create document version on update when published flag is set
onModelUpdate((e) => {
  // Only create version if published is true
  if (!e.model.get("published")) {
    return e.next()
  }
  
  // Get the current (old) state from database before update
  const oldRecord = $app.findRecordById("documents", e.model.id)
  const oldContent = oldRecord.get("content") || ""
  
  // Get latest version number
  const versions = $app.findRecordsByFilter(
    "document_versions",
    `document = "${e.model.id}"`,
    "-version_number",
    1
  )
  
  const versionNumber = versions.length > 0 ? versions[0].get("version_number") + 1 : 1
  
  // Create version from OLD content (before update) with a stable timestamp
  const now = new Date()
  const createdAt = now.toISOString()
  const pad = (value) => String(value).padStart(2, "0")
  const formattedDate = `${now.getFullYear()}.${pad(now.getMonth() + 1)}.${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`
  const collection = $app.findCollectionByNameOrId("document_versions")
  const version = new Record(collection)
  version.set("document", e.model.id)
  version.set("content", oldContent)
  version.set("version_number", versionNumber)
  version.set("change_summary", `Published on ${formattedDate}`)
  version.set("source_created_at", createdAt)
  
  $app.save(version)
  
  // Reset published flag after creating version
  e.model.set("published", false)
  
  return e.next()
}, "documents")
