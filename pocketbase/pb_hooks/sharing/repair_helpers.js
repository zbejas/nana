/// <reference path="../../pb_data/types.d.ts" />

// Durable reconciliation for access-grant rebuilds that cannot run in the same
// transaction as the record write (trash/rehome routes and one-off failures).
//
// The repair row is server-only: no API rule can read or write it. The cron in
// `sharing/repair_cron.js` retries every pending target and deletes the row on
// success. Until then the pre-transition grants were cleared, so a failed
// rebuild under-grants rather than leaking access.

function appOrGlobal(app) {
  return app || $app
}

function findCollection(app) {
  try {
    return appOrGlobal(app).findCollectionByNameOrId("sharing_repairs")
  } catch (_) {
    return null
  }
}

function errorText(err) {
  try {
    return String((err && err.message) || err || "unknown error").slice(0, 1000)
  } catch (_) {
    return "unknown error"
  }
}

/** Create or bump one repair row. Never throws. */
function flag(targetType, targetId, reason, err, app) {
  const db = appOrGlobal(app)
  const collection = findCollection(db)
  if (!collection) {
    console.error("Sharing repair queue missing; rebuild failed:", targetType, targetId, err)
    return
  }
  if (!targetType || !targetId) return

  try {
    let row = null
    try {
      row = db.findFirstRecordByFilter(
        "sharing_repairs",
        "target_type = {:type} && target_id = {:id}",
        { type: String(targetType), id: String(targetId) }
      )
    } catch (_) {
      row = null
    }

    if (!row) {
      row = new Record(collection)
      row.set("target_type", String(targetType))
      row.set("target_id", String(targetId))
      row.set("attempts", 0)
    }

    row.set("reason", String(reason || "grant_rebuild"))
    row.set("last_error", errorText(err))
    row.set("attempts", Number(row.get("attempts") || 0) + 1)
    db.save(row)
  } catch (flagErr) {
    console.error("Failed to record sharing repair flag:", flagErr)
  }
}

/** Best-effort rebuild used for create/restore paths where failing closed is safe. */
function safeSync(targetType, targetId, app, reason) {
  const db = appOrGlobal(app)
  const access = require(`${__hooks}/sharing/access_helpers.js`)
  try {
    if (targetType === "folder") {
      access.syncFolderSubtree(targetId, db)
    } else {
      access.syncResourceSharing(targetType, targetId, db)
    }
  } catch (err) {
    console.error("Failed to rebuild share access:", targetType, targetId, err)
    flag(targetType, targetId, reason, err, db)
  }
}

/** Retry every pending flag. Called by cron and by the admin repair route. */
function repairPending(app) {
  const db = appOrGlobal(app)
  const access = require(`${__hooks}/sharing/access_helpers.js`)
  let repaired = 0
  let failed = 0

  let rows = []
  try {
    rows = db.findRecordsByFilter("sharing_repairs", "", "+created", 0, 0)
  } catch (_) {
    return { repaired, failed }
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const type = String(row.get("target_type") || "")
    const id = String(row.get("target_id") || "")
    try {
      if (type === "folder") {
        access.syncFolderSubtree(id, db)
      } else {
        access.syncResourceSharing(type, id, db)
      }
      db.delete(row)
      repaired += 1
    } catch (err) {
      failed += 1
      row.set("attempts", Number(row.get("attempts") || 0) + 1)
      row.set("last_error", errorText(err))
      try {
        db.save(row)
      } catch (_) {}
    }
  }

  return { repaired, failed }
}

module.exports = {
  flag,
  safeSync,
  repairPending,
}
