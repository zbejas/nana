/// <reference path="../../pb_data/types.d.ts" />

// ── Public document share ───────────────────────────────────────────

routerAdd("GET", "/api/public/documents/{shareToken}", function(c) {
  var h = require(__hooks + "/routes/public_share_helpers.js")

  try {
    var shareToken = c.request.pathValue("shareToken")
    var documentRecord = h.ensureActivePublicShare(h.findPublicShareRecord("documents", shareToken))
    var authorRecord = h.findAuthorRecord(documentRecord.getString("author"))

    return c.json(200, {
      type: "document",
      shareToken: shareToken,
      expiresAt: h.toIsoOrNull(documentRecord.get("public_expires_at")),
      shareAttachments: documentRecord.getBool("share_attachments"),
      author: h.serializeAuthor(authorRecord),
      document: h.serializeDocument(documentRecord),
    })
  } catch (err) {
    if (err instanceof NotFoundError) {
      return c.json(404, { error: "Public document not found" })
    }

    console.error("Failed to fetch public document share:", err)
    return c.json(500, { error: "Failed to fetch public document share" })
  }
})

// ── Public document attachment ──────────────────────────────────────

routerAdd("GET", "/api/public/documents/{shareToken}/files/{filename}", function(c) {
  var h = require(__hooks + "/routes/public_share_helpers.js")

  try {
    var shareToken = c.request.pathValue("shareToken")
    var filename = c.request.pathValue("filename")
    var documentRecord = h.ensureActivePublicShare(h.findPublicShareRecord("documents", shareToken))

    if (!documentRecord.getBool("share_attachments")) {
      throw new NotFoundError("Attachment sharing disabled")
    }

    h.ensureAttachmentExists(documentRecord, filename)

    var filesystem = $app.newFilesystem()

    try {
      filesystem.serve(c.response, c.request, h.buildRecordFileKey(documentRecord, filename), h.getOriginalFilename(filename))
    } finally {
      filesystem.close()
    }
  } catch (err) {
    if (err instanceof NotFoundError) {
      return c.json(404, { error: "Public attachment not found" })
    }

    console.error("Failed to serve public document attachment:", err)
    return c.json(500, { error: "Failed to serve public attachment" })
  }
})

// ── Public folder share ─────────────────────────────────────────────

routerAdd("GET", "/api/public/folders/{shareToken}", function(c) {
  var h = require(__hooks + "/routes/public_share_helpers.js")

  try {
    var shareToken = c.request.pathValue("shareToken")
    var folderRecord = h.ensureActivePublicShare(h.findPublicShareRecord("folders", shareToken))
    var descendantFolders = h.collectFolderDescendants(folderRecord)
    var descendantFolderIds = []
    for (var i = 0; i < descendantFolders.length; i++) {
      descendantFolderIds.push(descendantFolders[i].id)
    }
    var descendantDocuments = h.collectFolderDocuments(descendantFolderIds)
    var authorRecord = h.findAuthorRecord(folderRecord.getString("author"))

    var serializedFolders = []
    for (var j = 0; j < descendantFolders.length; j++) {
      serializedFolders.push(h.serializeFolder(descendantFolders[j]))
    }

    var serializedDocuments = []
    for (var k = 0; k < descendantDocuments.length; k++) {
      serializedDocuments.push(h.serializeDocument(descendantDocuments[k]))
    }

    return c.json(200, {
      type: "folder",
      shareToken: shareToken,
      expiresAt: h.toIsoOrNull(folderRecord.get("public_expires_at")),
      shareAttachments: folderRecord.getBool("share_attachments"),
      author: h.serializeAuthor(authorRecord),
      rootFolder: h.serializeFolder(folderRecord),
      folders: serializedFolders,
      documents: serializedDocuments,
      entryDocumentId: descendantDocuments.length > 0 ? descendantDocuments[0].id : null,
    })
  } catch (err) {
    if (err instanceof NotFoundError) {
      return c.json(404, { error: "Public folder not found" })
    }

    console.error("Failed to fetch public folder share:", err)
    return c.json(500, { error: "Failed to fetch public folder share" })
  }
})

// ── Public folder attachment ────────────────────────────────────────

routerAdd("GET", "/api/public/folders/{shareToken}/files/{documentId}/{filename}", function(c) {
  var h = require(__hooks + "/routes/public_share_helpers.js")

  try {
    var shareToken = c.request.pathValue("shareToken")
    var documentId = c.request.pathValue("documentId")
    var filename = c.request.pathValue("filename")
    var folderRecord = h.ensureActivePublicShare(h.findPublicShareRecord("folders", shareToken))

    if (!folderRecord.getBool("share_attachments")) {
      throw new NotFoundError("Attachment sharing disabled")
    }

    var descendantFolders = h.collectFolderDescendants(folderRecord)
    var descendantFolderIdSet = {}
    for (var i = 0; i < descendantFolders.length; i++) {
      descendantFolderIdSet[descendantFolders[i].id] = true
    }
    var documentRecord = $app.findRecordById("documents", documentId)

    if (!descendantFolderIdSet[documentRecord.getString("folder")]) {
      throw new NotFoundError("Attachment not found")
    }

    if (documentRecord.getBool("is_private")) {
      throw new NotFoundError("Attachment not found")
    }

    h.ensureAttachmentExists(documentRecord, filename)

    var filesystem = $app.newFilesystem()

    try {
      filesystem.serve(c.response, c.request, h.buildRecordFileKey(documentRecord, filename), h.getOriginalFilename(filename))
    } finally {
      filesystem.close()
    }
  } catch (err) {
    if (err instanceof NotFoundError) {
      return c.json(404, { error: "Public attachment not found" })
    }

    console.error("Failed to serve public folder attachment:", err)
    return c.json(500, { error: "Failed to serve public attachment" })
  }
})
