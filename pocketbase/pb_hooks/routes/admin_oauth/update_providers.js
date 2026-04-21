/// <reference path="../../../pb_data/types.d.ts" />

// Admin endpoint to update OAuth2 provider configuration for the users collection
routerAdd("PATCH", "/api/admin/oauth/providers", (c) => {
  const { requireAdmin, parseRequestBody } = require(`${__hooks}/utils.js`)

  try {
    requireAdmin(c)

    const requestData = parseRequestBody(c)

    const usersCollection = $app.findCollectionByNameOrId("users")

    // Update enabled state if provided
    if (typeof requestData.enabled === "boolean") {
      usersCollection.oauth2.enabled = requestData.enabled
    }

    // Update providers if provided
    if (Array.isArray(requestData.providers)) {
      const existingProviders = usersCollection.oauth2.providers || []

      const updatedProviders = requestData.providers.map((p) => {
        // Find existing provider to preserve secret if not changed
        const existing = existingProviders.find((ep) => ep.name === p.name)

        // If clientSecret is the masked value or empty, keep the existing one
        let clientSecret = p.clientSecret || ""
        if (existing && (!clientSecret || clientSecret === "••••••••")) {
          clientSecret = existing.clientSecret || ""
        }

        return {
          name: p.name || "",
          displayName: p.displayName || "",
          clientId: p.clientId || "",
          clientSecret: clientSecret,
          authURL: p.authURL || "",
          tokenURL: p.tokenURL || "",
          userInfoURL: p.userInfoURL || "",
          pkce: typeof p.pkce === "boolean" ? p.pkce : undefined,
        }
      })

      usersCollection.oauth2.providers = updatedProviders
    }

    // Update mapped fields if provided
    if (requestData.mappedFields && typeof requestData.mappedFields === "object") {
      usersCollection.oauth2.mappedFields = {
        id: requestData.mappedFields.id || "",
        name: requestData.mappedFields.name || "",
        username: requestData.mappedFields.username || "",
        avatarURL: requestData.mappedFields.avatarURL || "",
      }
    }

    $app.save(usersCollection)

    return c.json(200, {
      success: true,
      message: "OAuth2 settings updated successfully",
    })
  } catch (err) {
    console.error("Failed to update OAuth2 settings:", err)
    return c.json(500, { error: "Failed to save OAuth2 settings: " + String(err) })
  }
}, $apis.requireAuth())
