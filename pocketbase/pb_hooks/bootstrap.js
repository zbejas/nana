/// <reference path="../pb_data/types.d.ts" />

/**
 * Bootstrap hook: seeds the site_url setting from SITE_URL env var if set.
 * Runs once on PocketBase startup and is idempotent (safe to restart).
 */
onBootstrap((e) => {
  const siteUrl = $os.getenv("SITE_URL")
  if (!siteUrl) return e.next()

  try {
    const record = $app.findFirstRecordByFilter("settings", "key = 'site_url'")
    record.set("value", { url: siteUrl.trim().replace(/\/+$/, "") })
    $app.save(record)
    console.log("Site URL seeded from environment variable: " + siteUrl)
  } catch (err) {
    console.error("Failed to seed site URL from environment variable:", err)
  }

  return e.next()
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
