/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId("settings")

    const record = new Record(collection, {
      key: "rate_limits",
      value: {
        enabled: false,
        pbMaxPerMinute: 600,
        appMaxPerMinute: 1200,
      },
      description:
        "Rate limiting configuration for the Bun server (per-IP, in-memory)",
    })

    app.save(record)

    return null
  },
  (app) => {
    try {
      const records = app.findRecordsByFilter(
        "settings",
        'key = "rate_limits"',
        "",
        1,
        0
      )
      if (records && records.length > 0) {
        app.delete(records[0])
      }
    } catch (_) {
      // already gone
    }

    return null
  }
)
