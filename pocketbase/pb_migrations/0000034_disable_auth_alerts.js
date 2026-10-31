/// <reference path="../pb_data/types.d.ts" />

// PocketBase enables the "new device login" auth alert by default. Those
// emails ship with the "Acme" app name, duplicate the in-app sign-in flow, and
// only work when SMTP is configured. Nana keeps them off for both user and
// superuser sign-ins; the custom mailer/auth_alert.js template remains
// available if an instance re-enables them.

const AUTH_ALERT_COLLECTIONS = ["users", "_superusers"]

migrate(
  (app) => {
    for (const name of AUTH_ALERT_COLLECTIONS) {
      const collection = app.findCollectionByNameOrId(name)
      if (collection.authAlert && collection.authAlert.enabled) {
        collection.authAlert.enabled = false
        app.save(collection)
      }
    }
    return null
  },
  (app) => {
    for (const name of AUTH_ALERT_COLLECTIONS) {
      const collection = app.findCollectionByNameOrId(name)
      if (collection.authAlert && !collection.authAlert.enabled) {
        collection.authAlert.enabled = true
        app.save(collection)
      }
    }
    return null
  }
)
