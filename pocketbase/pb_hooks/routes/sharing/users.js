/// <reference path="../../../pb_data/types.d.ts" />

// User directory for the share picker. Authenticated users may search names
// and emails, but this is not a general admin user list.

routerAdd("GET", "/api/sharing/users", (c) => {
  const h = require(`${__hooks}/routes/sharing/sharing_helpers.js`)

  try {
    const me = h.authId(c)
    const query = h.queryValue(c, "q")
    if (query.length > 100) {
      throw new BadRequestError("Search is too long")
    }

    const filter = query
      ? "(name ~ {:q} || email ~ {:q}) && id != {:me}"
      : "id != {:me}"
    const users = $app.findRecordsByFilter(
      "users",
      filter,
      "name,email",
      20,
      0,
      { q: query, me }
    )

    return c.json(200, {
      items: users.map((user) => h.serializeUser(user)),
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
