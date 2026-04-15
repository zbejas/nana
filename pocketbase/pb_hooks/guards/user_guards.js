/// <reference path="../../pb_data/types.d.ts" />

// Guard: prevent new user signups after the first user is created.
// Admins can still create users through the authenticated API.
// Only verified users can grant the admin field to new users.
onRecordCreateRequest((e) => {
  const { isVerifiedUser, hasExistingUsers } = require(`${__hooks}/utils.js`);

  // Always allow the very first user to be created
  if (!hasExistingUsers()) {
    e.record.set("admin", true);
    return e.next();
  }

  // Superusers (PocketBase superadmins) bypass all checks
  if (e.hasSuperuserAuth()) {
    return e.next();
  }

  // Check if there is an authenticated user making the request
  if (e.auth) {
    const isAdmin = e.auth.get("admin");

    if (isAdmin === true) {
      // Enforce: only verified users can grant admin privileges to new users
      if (e.record.get("admin") === true && !isVerifiedUser(e.auth)) {
        throw new BadRequestError("Only verified users can grant administrator privileges.");
      }
      return e.next();
    }
  }

  throw new BadRequestError("User registration is disabled. Only admins can create new users.");
}, "users");

// After the first successful user creation, lock public signup.
onRecordAfterCreateSuccess((e) => {
  try {
    const { hasExistingUsers } = require(`${__hooks}/utils.js`);

    // Verify only the very first created user.
    // hasExistingUsers(excludeId) checks whether there are users other than this record.
    if (!hasExistingUsers(e.record.id) && e.record.get("verified") !== true) {
      e.record.set("verified", true);
      $app.save(e.record);
    }

    // Always lock public signup after a successful create.
    const usersCollection = $app.findCollectionByNameOrId("users");
    usersCollection.createRule = "@request.auth.admin = true";
    $app.save(usersCollection);
  } catch (_err) {
  }

  return e.next();
}, "users");


// Guard: block deletion of verified users (protects the original admin).
onRecordDeleteRequest((e) => {
  const { isVerifiedUser } = require(`${__hooks}/utils.js`);

  if (isVerifiedUser(e.record)) {
    throw new BadRequestError("Cannot delete a verified user.");
  }
  return e.next();
}, "users");
