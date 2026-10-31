/// <reference path="../../../pb_data/types.d.ts" />

// Admin endpoint to get OAuth2 provider configuration for the users collection
routerAdd("GET", "/api/admin/oauth/providers", (c) => {
  const { requireAdmin, sendError } = require(`${__hooks}/utils.js`)

  try {
    requireAdmin(c)

    const usersCollection = $app.findCollectionByNameOrId("users")
    const oauth2 = usersCollection.oauth2 || {}
    const providers = oauth2.providers || []
    const enabled = oauth2.enabled || false
    const mappedFields = oauth2.mappedFields || {}

    // Return providers without exposing client secrets
    const safeProviders = providers.map((p) => ({
      name: p.name || "",
      displayName: p.displayName || "",
      clientId: p.clientId || "",
      clientSecret: p.clientSecret ? "••••••••" : "",
      authURL: p.authURL || "",
      tokenURL: p.tokenURL || "",
      userInfoURL: p.userInfoURL || "",
      pkce: p.pkce,
    }))

    return c.json(200, {
      enabled,
      providers: safeProviders,
      mappedFields,
    })
  } catch (err) {
    return sendError(c, err, "Failed to load OAuth2 settings")
  }
}, $apis.requireAuth())
