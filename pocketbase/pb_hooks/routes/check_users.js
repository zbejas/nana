/// <reference path="../../pb_data/types.d.ts" />

// Public endpoint to check if any users exist in the system
// This runs with admin privileges so it can access the users collection
routerAdd("GET", "/api/check-users", (c) => {
  try {
    const users = $app.findRecordsByFilter(
      "users",
      "",
      "-created",
      1
    )
    
    return c.json(200, {
      hasUsers: users.length > 0,
      totalUsers: users.length
    })
  } catch (err) {
    console.error("Failed to check users:", err)
    return c.json(500, {
      error: "Failed to check users",
      hasUsers: false
    })
  }
})
