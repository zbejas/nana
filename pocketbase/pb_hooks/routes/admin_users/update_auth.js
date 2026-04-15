/// <reference path="../../../pb_data/types.d.ts" />

// Admin route to update users without oldPassword requirement
routerAdd(
  "PATCH",
  "/api/admin/users/{id}",
  (c) => {
    const { requireAdmin, parseRequestBody, isVerifiedUser } = require(`${__hooks}/utils.js`)

    try {
    // Check admin access
    requireAdmin(c)

    // Extract user ID from URL path (e.g., /api/admin/users/b3yyewq7s1nqxxd)
    const userId = c.request.url.path.split('/').pop()
    if (!userId) {
      return c.json(400, { error: "User ID is required" })
    }

    // Parse request body
    const requestData = parseRequestBody(c)

    if (!requestData || Object.keys(requestData).length === 0) {
      return c.json(400, { error: "Request body is required" })
    }

    // Only verified users can grant admin privileges
    if (requestData.admin === true && !isVerifiedUser(c.auth)) {
      return c.json(403, { error: "Only verified users can grant administrator privileges." })
    }

    // Find the user record
    const record = $app.findRecordById("users", userId)
    if (!record) {
      return c.json(404, { error: "User not found" })
    }

    // Update fields directly on the record (bypasses API validation)
    if (requestData.email !== undefined) {
      record.set("email", requestData.email)
    }
    if (requestData.name !== undefined) {
      record.set("name", requestData.name)
    }
    if (requestData.admin !== undefined) {
      record.set("admin", requestData.admin)
    }

    // Handle password change - use setPassword to bypass oldPassword validation
    if (requestData.password) {
      record.setPassword(requestData.password)
    }

    // Save the record
    $app.save(record)

    // Return updated record (without password field)
    return c.json(200, record.publicExport())

  } catch (err) {
    console.error("Failed to update user:", err)
    return c.json(500, { error: "Failed to update user: " + String(err) })
  }
},
$apis.requireAuth()
)
