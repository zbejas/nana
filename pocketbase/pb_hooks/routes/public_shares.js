/// <reference path="../../pb_data/types.d.ts" />

routerAdd("GET", "/api/public/documents/{shareToken}", (c) => {
  try {
    const toIsoOrNull = (value) => {
      if (!value) {
        return null
      }

      const asString = String(value).trim()
      return asString ? asString : null
    }

    const isExpired = (record) => {
      const expiresAt = toIsoOrNull(record.get("public_expires_at"))
      if (!expiresAt) {
        return false
      }

      const expiresAtMs = Date.parse(expiresAt)
      if (!Number.isFinite(expiresAtMs)) {
        return false
      }

      return expiresAtMs <= Date.now()
    }

    const disablePublicShare = (record) => {
      record.set("is_public", false)
      record.set("public_share_token", "")
      record.set("public_expires_at", "")
      $app.save(record)
    }

    const findPublicShareRecord = (collectionName, token) => {
      try {
        return $app.findFirstRecordByFilter(
          collectionName,
          "public_share_token = {:token}",
          { token }
        )
      } catch (_) {
        return null
      }
    }

    const ensureActivePublicShare = (record) => {
      if (!record || !record.getBool("is_public")) {
        throw new NotFoundError("Public share not found")
      }

      if (isExpired(record)) {
        disablePublicShare(record)
        throw new NotFoundError("Public share not found")
      }

      return record
    }

    const findAuthorRecord = (authorId) => {
      if (!authorId) {
        return null
      }

      try {
        return $app.findRecordById("users", authorId)
      } catch (_) {
        return null
      }
    }

    const serializeAuthor = (authorRecord) => {
      if (!authorRecord) {
        return null
      }

      return {
        id: authorRecord.id,
        name: authorRecord.getString("name") || authorRecord.getString("email") || "Unknown",
      }
    }

    const serializeDocument = (record) => ({
      id: record.id,
      title: record.getString("title"),
      slug: record.getString("slug"),
      content: record.getString("content") || "",
      attachments: record.getStringSlice("attachments"),
      tags: record.get("tags") || [],
      author: record.getString("author"),
      folder: record.getString("folder") || "",
      word_count: record.getInt("word_count") || 0,
      reading_time: record.getInt("reading_time") || 0,
      created: toIsoOrNull(record.get("created")),
      updated: toIsoOrNull(record.get("updated")),
    })

    const shareToken = c.request.pathValue("shareToken")
    const documentRecord = ensureActivePublicShare(findPublicShareRecord("documents", shareToken))
    const authorRecord = findAuthorRecord(documentRecord.getString("author"))

    return c.json(200, {
      type: "document",
      shareToken,
      expiresAt: toIsoOrNull(documentRecord.get("public_expires_at")),
      author: serializeAuthor(authorRecord),
      document: serializeDocument(documentRecord),
    })
  } catch (err) {
    if (err instanceof NotFoundError) {
      return c.json(404, { error: "Public document not found" })
    }

    console.error("Failed to fetch public document share:", err)
    return c.json(500, { error: "Failed to fetch public document share" })
  }
})

routerAdd("GET", "/api/public/documents/{shareToken}/files/{filename}", (c) => {
  try {
    const buildRecordFileKey = (record, filename) => {
      const baseFilesPath = String(record.baseFilesPath() || "").replace(/\/+$/, "")
      const cleanFilename = String(filename || "").replace(/^\/+/, "")

      if (!baseFilesPath || !cleanFilename) {
        throw new Error("Cannot build file key for record attachment")
      }

      return `${baseFilesPath}/${cleanFilename}`
    }

    const toIsoOrNull = (value) => {
      if (!value) {
        return null
      }

      const asString = String(value).trim()
      return asString ? asString : null
    }

    const isExpired = (record) => {
      const expiresAt = toIsoOrNull(record.get("public_expires_at"))
      if (!expiresAt) {
        return false
      }

      const expiresAtMs = Date.parse(expiresAt)
      if (!Number.isFinite(expiresAtMs)) {
        return false
      }

      return expiresAtMs <= Date.now()
    }

    const disablePublicShare = (record) => {
      record.set("is_public", false)
      record.set("public_share_token", "")
      record.set("public_expires_at", "")
      $app.save(record)
    }

    const findPublicShareRecord = (collectionName, token) => {
      try {
        return $app.findFirstRecordByFilter(
          collectionName,
          "public_share_token = {:token}",
          { token }
        )
      } catch (_) {
        return null
      }
    }

    const ensureActivePublicShare = (record) => {
      if (!record || !record.getBool("is_public")) {
        throw new NotFoundError("Public share not found")
      }

      if (isExpired(record)) {
        disablePublicShare(record)
        throw new NotFoundError("Public share not found")
      }

      return record
    }

    const ensureAttachmentExists = (record, filename) => {
      const attachments = record.getStringSlice("attachments")
      if (!attachments.includes(filename)) {
        throw new NotFoundError("Attachment not found")
      }
    }

    const shareToken = c.request.pathValue("shareToken")
    const filename = c.request.pathValue("filename")
    const documentRecord = ensureActivePublicShare(findPublicShareRecord("documents", shareToken))

    ensureAttachmentExists(documentRecord, filename)

    const filesystem = $app.newFilesystem()

    try {
      filesystem.serve(c.response, c.request, buildRecordFileKey(documentRecord, filename), filename)
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

routerAdd("GET", "/api/public/folders/{shareToken}", (c) => {
  try {
    const toIsoOrNull = (value) => {
      if (!value) {
        return null
      }

      const asString = String(value).trim()
      return asString ? asString : null
    }

    const isExpired = (record) => {
      const expiresAt = toIsoOrNull(record.get("public_expires_at"))
      if (!expiresAt) {
        return false
      }

      const expiresAtMs = Date.parse(expiresAt)
      if (!Number.isFinite(expiresAtMs)) {
        return false
      }

      return expiresAtMs <= Date.now()
    }

    const disablePublicShare = (record) => {
      record.set("is_public", false)
      record.set("public_share_token", "")
      record.set("public_expires_at", "")
      $app.save(record)
    }

    const findPublicShareRecord = (collectionName, token) => {
      try {
        return $app.findFirstRecordByFilter(
          collectionName,
          "public_share_token = {:token}",
          { token }
        )
      } catch (_) {
        return null
      }
    }

    const ensureActivePublicShare = (record) => {
      if (!record || !record.getBool("is_public")) {
        throw new NotFoundError("Public share not found")
      }

      if (isExpired(record)) {
        disablePublicShare(record)
        throw new NotFoundError("Public share not found")
      }

      return record
    }

    const findAuthorRecord = (authorId) => {
      if (!authorId) {
        return null
      }

      try {
        return $app.findRecordById("users", authorId)
      } catch (_) {
        return null
      }
    }

    const serializeAuthor = (authorRecord) => {
      if (!authorRecord) {
        return null
      }

      return {
        id: authorRecord.id,
        name: authorRecord.getString("name") || authorRecord.getString("email") || "Unknown",
      }
    }

    const serializeDocument = (record) => ({
      id: record.id,
      title: record.getString("title"),
      slug: record.getString("slug"),
      content: record.getString("content") || "",
      attachments: record.getStringSlice("attachments"),
      tags: record.get("tags") || [],
      author: record.getString("author"),
      folder: record.getString("folder") || "",
      word_count: record.getInt("word_count") || 0,
      reading_time: record.getInt("reading_time") || 0,
      created: toIsoOrNull(record.get("created")),
      updated: toIsoOrNull(record.get("updated")),
    })

    const serializeFolder = (record) => ({
      id: record.id,
      name: record.getString("name"),
      parent: record.getString("parent") || "",
      author: record.getString("author"),
      color: record.getString("color") || "",
      created: toIsoOrNull(record.get("created")),
      updated: toIsoOrNull(record.get("updated")),
    })

    const collectFolderDescendants = (folderRecord) => {
      const descendants = []
      const queue = [folderRecord]

      while (queue.length > 0) {
        const current = queue.shift()
        if (!current) {
          continue
        }

        descendants.push(current)

        const children = $app.findRecordsByFilter(
          "folders",
          "parent = {:parentId}",
          "+name",
          500,
          0,
          { parentId: current.id }
        )

        for (const child of children) {
          queue.push(child)
        }
      }

      return descendants
    }

    const collectFolderDocuments = (folderIds) => {
      const documents = []

      for (const folderId of folderIds) {
        const folderDocuments = $app.findRecordsByFilter(
          "documents",
          "folder = {:folderId}",
          "+title",
          500,
          0,
          { folderId }
        )

        for (const document of folderDocuments) {
          documents.push(document)
        }
      }

      return documents
    }

    const shareToken = c.request.pathValue("shareToken")
    const folderRecord = ensureActivePublicShare(findPublicShareRecord("folders", shareToken))
    const descendantFolders = collectFolderDescendants(folderRecord)
    const descendantFolderIds = descendantFolders.map((folder) => folder.id)
    const descendantDocuments = collectFolderDocuments(descendantFolderIds)
    const authorRecord = findAuthorRecord(folderRecord.getString("author"))

    return c.json(200, {
      type: "folder",
      shareToken,
      expiresAt: toIsoOrNull(folderRecord.get("public_expires_at")),
      author: serializeAuthor(authorRecord),
      rootFolder: serializeFolder(folderRecord),
      folders: descendantFolders.map(serializeFolder),
      documents: descendantDocuments.map(serializeDocument),
      entryDocumentId: descendantDocuments[0]?.id || null,
    })
  } catch (err) {
    if (err instanceof NotFoundError) {
      return c.json(404, { error: "Public folder not found" })
    }

    console.error("Failed to fetch public folder share:", err)
    return c.json(500, { error: "Failed to fetch public folder share" })
  }
})

routerAdd("GET", "/api/public/folders/{shareToken}/files/{documentId}/{filename}", (c) => {
  try {
    const buildRecordFileKey = (record, filename) => {
      const baseFilesPath = String(record.baseFilesPath() || "").replace(/\/+$/, "")
      const cleanFilename = String(filename || "").replace(/^\/+/, "")

      if (!baseFilesPath || !cleanFilename) {
        throw new Error("Cannot build file key for record attachment")
      }

      return `${baseFilesPath}/${cleanFilename}`
    }

    const toIsoOrNull = (value) => {
      if (!value) {
        return null
      }

      const asString = String(value).trim()
      return asString ? asString : null
    }

    const isExpired = (record) => {
      const expiresAt = toIsoOrNull(record.get("public_expires_at"))
      if (!expiresAt) {
        return false
      }

      const expiresAtMs = Date.parse(expiresAt)
      if (!Number.isFinite(expiresAtMs)) {
        return false
      }

      return expiresAtMs <= Date.now()
    }

    const disablePublicShare = (record) => {
      record.set("is_public", false)
      record.set("public_share_token", "")
      record.set("public_expires_at", "")
      $app.save(record)
    }

    const findPublicShareRecord = (collectionName, token) => {
      try {
        return $app.findFirstRecordByFilter(
          collectionName,
          "public_share_token = {:token}",
          { token }
        )
      } catch (_) {
        return null
      }
    }

    const ensureActivePublicShare = (record) => {
      if (!record || !record.getBool("is_public")) {
        throw new NotFoundError("Public share not found")
      }

      if (isExpired(record)) {
        disablePublicShare(record)
        throw new NotFoundError("Public share not found")
      }

      return record
    }

    const collectFolderDescendants = (folderRecord) => {
      const descendants = []
      const queue = [folderRecord]

      while (queue.length > 0) {
        const current = queue.shift()
        if (!current) {
          continue
        }

        descendants.push(current)

        const children = $app.findRecordsByFilter(
          "folders",
          "parent = {:parentId}",
          "+name",
          500,
          0,
          { parentId: current.id }
        )

        for (const child of children) {
          queue.push(child)
        }
      }

      return descendants
    }

    const ensureAttachmentExists = (record, filename) => {
      const attachments = record.getStringSlice("attachments")
      if (!attachments.includes(filename)) {
        throw new NotFoundError("Attachment not found")
      }
    }

    const shareToken = c.request.pathValue("shareToken")
    const documentId = c.request.pathValue("documentId")
    const filename = c.request.pathValue("filename")
    const folderRecord = ensureActivePublicShare(findPublicShareRecord("folders", shareToken))
    const descendantFolders = collectFolderDescendants(folderRecord)
    const descendantFolderIds = new Set(descendantFolders.map((folder) => folder.id))
    const documentRecord = $app.findRecordById("documents", documentId)

    if (!descendantFolderIds.has(documentRecord.getString("folder"))) {
      throw new NotFoundError("Attachment not found")
    }

    ensureAttachmentExists(documentRecord, filename)

    const filesystem = $app.newFilesystem()

    try {
      filesystem.serve(c.response, c.request, buildRecordFileKey(documentRecord, filename), filename)
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