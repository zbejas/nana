/// <reference path="../../pb_data/types.d.ts" />

// Retry access-grant rebuilds that failed outside a request transaction.
// `sharing_repairs` rows are written by trash/rehome paths and by safe create
// paths; the request-hook privacy/folder transitions fail and roll back instead
// of queueing, so this queue can never mask a failed revocation.

cronAdd("sharing-grant-repair", "*/10 * * * *", () => {
  try {
    const repair = require(`${__hooks}/sharing/repair_helpers.js`)
    const result = repair.repairPending($app)
    if (result.repaired > 0 || result.failed > 0) {
      console.log(
        `Sharing grant repair: ${result.repaired} repaired, ${result.failed} still failing`
      )
    }
  } catch (err) {
    console.error("Failed to run sharing grant repair:", err)
  }
})
