/// <reference path="../../pb_data/types.d.ts" />

// Admin endpoint to sync PocketBase's meta.appURL (used for OAuth2 redirect URIs)
routerAdd("PATCH", "/api/admin/app-url", (c) => {
  const { requireAdmin, parseRequestBody } = require(`${__hooks}/utils.js`)

  try {
    requireAdmin(c)

    const requestData = parseRequestBody(c)
    const url = (requestData.url || "").trim().replace(/\/+$/, "")

    if (!url) {
      return c.json(400, { error: "URL is required" })
    }

    const settings = $app.settings()
    settings.meta.appURL = url
    $app.save(settings)

    return c.json(200, {
      success: true,
      message: "Application URL updated",
      appURL: url,
    })
  } catch (err) {
    console.error("Failed to update appURL:", err)
    return c.json(500, { error: "Failed to update application URL: " + String(err) })
  }
}, $apis.requireAuth())
