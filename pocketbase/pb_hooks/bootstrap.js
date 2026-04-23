/// <reference path="../pb_data/types.d.ts" />

/**
 * Bootstrap hook: seeds the site_url setting from SITE_URL env var if set,
 * and syncs PocketBase's meta.appURL for OAuth2 redirect URIs.
 * Runs once on PocketBase startup and is idempotent (safe to restart).
 */
onBootstrap((e) => {
  e.next()

  /** Sync PocketBase's internal meta.appURL from a URL string. */
  const syncAppURL = (url) => {
    if (!url) return
    try {
      const settings = $app.settings()
      const cleaned = url.trim().replace(/\/+$/, "")
      if (settings.meta.appURL !== cleaned) {
        settings.meta.appURL = cleaned
        $app.save(settings)
        console.log("PocketBase appURL synced to: " + cleaned)
      }
    } catch (err) {
      console.error("Failed to sync PocketBase appURL:", err)
    }
  }

  const siteUrl = $os.getenv("SITE_URL")

  if (siteUrl) {
    try {
      const cleaned = siteUrl.trim().replace(/\/+$/, "")
      const record = $app.findFirstRecordByFilter("settings", "key = 'site_url'")
      record.set("value", { url: cleaned })
      $app.save(record)
      console.log("Site URL seeded from environment variable: " + siteUrl)
      syncAppURL(cleaned)
    } catch (err) {
      console.error("Failed to seed site URL from environment variable:", err)
    }
  } else {
    // No env var — sync appURL from the existing site_url setting
    try {
      const record = $app.findFirstRecordByFilter("settings", "key = 'site_url'")
      const value = record.get("value")
      const url = (value && typeof value === "object") ? (value.url || "") : ""
      syncAppURL(url)
    } catch (_) {
      // No site_url record yet — nothing to sync
    }
  }
})

/**
 * Bootstrap hook: auto-provisions a superuser account for internal API access.
 * 
 * If PB_SUPERUSER_EMAIL and PB_SUPERUSER_PASSWORD env vars are set, uses those.
 * Otherwise, checks for an existing credentials file in pb_data/.
 * If no credentials exist anywhere, generates random ones and persists them.
 * 
 * The Bun server reads the same credentials (env vars or file) to obtain
 * a superuser token for accessing admin-only data like AI config.
 */
onBootstrap((e) => {
  e.next()

  // Skip superuser provisioning during `migrate up` — it will run on `serve`
  if ($os.getenv("PB_MIGRATING") === "1") return

  const defaultDataDir = $filepath.join($filepath.dir(__hooks), "pb_data")
  const credentialsPath = $filepath.join($os.getenv("PB_DATA_DIR") || defaultDataDir, "superuser_credentials.json")
  let email = $os.getenv("PB_SUPERUSER_EMAIL") || ""
  let password = $os.getenv("PB_SUPERUSER_PASSWORD") || ""
  let fromEnv = false
  let generated = false

  if (email && password) {
    fromEnv = true
  } else {
    // Try reading from existing credentials file
    try {
      const raw = toString($os.readFile(credentialsPath))
      const creds = JSON.parse(raw)
      if (creds.email && creds.password) {
        email = creds.email
        password = creds.password
      }
    } catch (_) {
      // File doesn't exist or is invalid — will generate below
    }
  }

  // Generate new credentials if we still don't have any
  if (!email || !password) {
    const id = $security.randomString(8).toLowerCase()
    email = "nana-" + id + "@localhost.lan"
    password = $security.randomString(32)
    generated = true
  }

  try {
    const superusersCollection = $app.findCollectionByNameOrId("_superusers")

    // Check if this superuser already exists
    let record
    try {
      record = $app.findAuthRecordByEmail("_superusers", email)
      // Update password to stay in sync with env vars / file
      record.setPassword(password)
      $app.save(record)
    } catch (_) {
      // Superuser doesn't exist — create it
      record = new Record(superusersCollection)
      record.setEmail(email)
      record.setPassword(password)
      record.setVerified(true)
      $app.save(record)
    }

    // Persist credentials to file (always, to keep in sync)
    if (!fromEnv) {
      try {
        const data = JSON.stringify({ email: email, password: password }, null, 2)
        $os.writeFile(credentialsPath, data, 0o600)
        if (generated) {
          console.log("Nana superuser credentials saved to " + credentialsPath)
        }
      } catch (writeErr) {
        console.error("Failed to write superuser credentials file:", writeErr)
      }
    }

    console.log("Nana superuser ready: " + email)
  } catch (err) {
    console.error("Failed to provision Nana superuser:", err)
  }
})

// Ensure users create requests reach this guard hook.
// If createRule requires admin auth, PocketBase rejects before onRecordCreateRequest runs.
onBootstrap((e) => {
  e.next();

  try {
    const { hasExistingUsers } = require(`${__hooks}/utils.js`);
    const usersCollection = $app.findCollectionByNameOrId("users");

    if (hasExistingUsers()) {
      if (usersCollection.createRule !== "@request.auth.admin = true") {
        usersCollection.createRule = "@request.auth.admin = true";
        $app.save(usersCollection);
      }
    } else {
      if (usersCollection.createRule !== "") {
        usersCollection.createRule = "";
        $app.save(usersCollection);
      }
    }
  } catch (_err) {
  }
});

/**
 * Migration filename compatibility hook.
 * Renames old-style migration filenames to the 0000001_ sequential format
 * in the _migrations table. This ensures existing PocketBase instances that ran
 * migrations under the old numeric naming scheme continue to work after the rename.
 *
 * Idempotent: no-ops if filenames already match or rows don't exist.
 *
 * TODO: Remove this hook in v0.3.0 or later — by then all instances will have been migrated.
 */
onBootstrap((e) => {
  e.next()

  const renames = [
    // [oldName, newName] — covers original filename variants
    ["0_init_users.js",                            "0000001_init_users.js"],
    ["1_created_folders.js",                       "0000002_created_folders.js"],
    ["2_created_trash_collections.js",             "0000003_created_trash_collections.js"],
    ["3_created_settings.js",                      "0000004_created_settings.js"],
    ["4_set_smtp_meta.js",                         "0000005_set_smtp_meta.js"],
    ["5_created_ai_settings.js",                   "0000006_created_ai_settings.js"],
    ["6_created_chat_collections.js",              "0000007_created_chat_collections.js"],
    ["7_created_rate_limits_setting.js",           "0000008_created_rate_limits_setting.js"],
    ["8_created_embedding_settings.js",            "0000009_created_embedding_settings.js"],
    ["9_sync_trash_attachment_settings.js",        "0000010_sync_trash_attachment_settings.js"],
    ["10_preserve_document_version_timestamps.js", "0000011_preserve_document_version_timestamps.js"],
    ["11_add_public_sharing.js",                   "0000012_add_public_sharing.js"],
    ["12_add_privacy_and_attachment_sharing.js",   "0000013_add_privacy_and_attachment_sharing.js"],
    ["13_add_ai_system_prompt.js",                 "0000014_add_ai_system_prompt.js"],
  ]

  let updated = 0
  for (const [oldName, newName] of renames) {
    try {
      const result = $app.db()
        .newQuery("UPDATE _migrations SET file = {:new} WHERE file = {:old}")
        .bind({ new: newName, old: oldName })
        .execute()
      if (result.rowsAffected > 0) updated++
    } catch (_) {
      // Ignore — row may not exist (fresh DB or already renamed)
    }
  }

  if (updated > 0) {
    console.log("Migration compat: renamed " + updated + " migration(s) in _migrations table")
  }
})
