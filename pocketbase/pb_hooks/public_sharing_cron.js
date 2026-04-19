/// <reference path="../pb_data/types.d.ts" />

cronAdd("cleanup-expired-public-shares", "*/15 * * * *", () => {
  try {
    const clearExpiredPublicShares = (collectionName) => {
      const expiredRecords = $app.findRecordsByFilter(
        collectionName,
        "is_public = true && public_expires_at != '' && public_expires_at <= @now",
        "",
        500
      )

      for (const record of expiredRecords) {
        record.set("is_public", false)
        record.set("public_share_token", "")
        record.set("public_expires_at", "")
        $app.save(record)
      }

      return expiredRecords.length
    }

    const expiredDocuments = clearExpiredPublicShares("documents")
    const expiredFolders = clearExpiredPublicShares("folders")

    if (expiredDocuments > 0 || expiredFolders > 0) {
      console.log(
        `Expired public shares cleaned up: ${expiredDocuments} documents, ${expiredFolders} folders`
      )
    }
  } catch (err) {
    console.error("Failed to clean up expired public shares:", err)
  }
})