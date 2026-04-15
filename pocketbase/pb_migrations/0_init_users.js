/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const usersCollection = app.findCollectionByNameOrId("users")
  
  // Add admin field to users collection
  usersCollection.fields.add(new BoolField({
    name: "admin",
    required: false,
  }))
  
  // Set list rule to allow admins to see all users, or users to see themselves
  // @request.auth.id = id means users can see their own record
  // @request.auth.admin = true means admins can see all records
  usersCollection.listRule = "@request.auth.id != '' && (@request.auth.id = id || @request.auth.admin = true)"
  
  // View rule - same as list rule
  usersCollection.viewRule = "@request.auth.id != '' && (@request.auth.id = id || @request.auth.admin = true)"
  
  // Update rule - users can update their own profile, admins can update anyone
  usersCollection.updateRule = "@request.auth.id != '' && (@request.auth.id = id || @request.auth.admin = true)"
  
  // Delete rule - only admins can delete users
  usersCollection.deleteRule = "@request.auth.admin = true"
  
  app.save(usersCollection)
  
  // Set emailVisibility to true for all users (makes emails visible to admins)
  const users = app.findRecordsByFilter("users", "")
  users.forEach((user) => {
    user.set("emailVisibility", true)
    app.save(user)
  })
  
  return null
}, (app) => {
  const usersCollection = app.findCollectionByNameOrId("users")
  
  // Remove admin field
  const adminField = usersCollection.fields.getByName("admin")
  usersCollection.fields.remove(adminField.id)
  
  // Revert to default rules (only see own record)
  usersCollection.listRule = "@request.auth.id != '' && @request.auth.id = id"
  usersCollection.viewRule = "@request.auth.id != '' && @request.auth.id = id"
  usersCollection.updateRule = "@request.auth.id != '' && @request.auth.id = id"
  usersCollection.deleteRule = null
  
  return app.save(usersCollection)
})
