/// <reference path="../../../pb_data/types.d.ts" />

// User directory for the share picker. This is not an admin user list:
// name/avatar are exposed for suggestions, email only for an exact address
// match, and admin/verification state is never returned.

routerAdd("GET", "/api/sharing/users", (c) => {
  const h = require(`${__hooks}/routes/sharing/sharing_helpers.js`)

  try {
    const me = h.authId(c)
    const query = h.queryValue(c, "q")
    if (query.length > 100) {
      throw new BadRequestError("Search is too long")
    }

    let users = []
    let exactEmail = false

    if (query.indexOf("@") !== -1) {
      // Exact-address lookup only. Do not offer fuzzy email discovery.
      exactEmail = true
      users = $app.findRecordsByFilter(
        "users",
        "email = {:q} && id != {:me}",
        "name",
        5,
        0,
        { q: query, me }
      )
    } else {
      const filter = query ? "name ~ {:q} && id != {:me}" : "id != {:me}"
      users = $app.findRecordsByFilter(
        "users",
        filter,
        "name",
        20,
        0,
        { q: query, me }
      )
    }

    return c.json(200, {
      items: users.map((user) => h.serializeDirectoryUser(user, exactEmail)),
    })
  } catch (err) {
    if (err instanceof BadRequestError) {
      return c.json(400, { error: String(err) })
    }
    if (err instanceof UnauthorizedError) {
      return c.json(401, { error: "Authentication required" })
    }
    console.error("Failed to search share users:", err)
    return c.json(500, { error: "Failed to search users" })
  }
}, $apis.requireAuth())
