/// <reference path="../pb_data/types.d.ts" />

// Bootstrap (env seeding)
require(`${__hooks}/bootstrap.js`);
require(`${__hooks}/public_sharing_cron.js`);

// Document hooks
require(`${__hooks}/documents/calculate_stats.js`);
require(`${__hooks}/documents/revision_guard.js`);

// Board and task hooks. Request hooks run in registration order: task guards
// validate before the lifecycle/activity transaction wrappers, and sharing
// permission guards run before the access hooks that save and rebuild grants.
require(`${__hooks}/boards/seed_columns.js`);
require(`${__hooks}/boards/column_guards.js`);
require(`${__hooks}/boards/repair_columns.js`);
require(`${__hooks}/tasks/status_guard.js`);
require(`${__hooks}/tasks/assignee_guard.js`);
require(`${__hooks}/sharing/permission_guards.js`);
require(`${__hooks}/sharing/access_hooks.js`);
require(`${__hooks}/tasks/lifecycle.js`);
require(`${__hooks}/tasks/record_activity.js`);

// Folder hooks

// Mailer hooks
require(`${__hooks}/mailer/password_reset.js`);
require(`${__hooks}/mailer/email_change.js`);
require(`${__hooks}/mailer/otp.js`);
require(`${__hooks}/mailer/auth_alert.js`);

// API routes
require(`${__hooks}/routes/admin_smtp.js`);
require(`${__hooks}/routes/admin_users.js`);
require(`${__hooks}/routes/admin_attachments.js`);
require(`${__hooks}/routes/admin_oauth.js`);
require(`${__hooks}/routes/admin_instance.js`);
require(`${__hooks}/routes/check_users.js`);
require(`${__hooks}/routes/public_shares.js`);
require(`${__hooks}/routes/trash.js`);

// Guard hooks
require(`${__hooks}/guards/user_guards.js`);
require(`${__hooks}/guards/relation_guards.js`);

// User-sharing routes. Permission guards and access hooks are registered with
// the board/task hooks above so every write sees the same hook order.
require(`${__hooks}/sharing/repair_cron.js`);
require(`${__hooks}/routes/sharing/links.js`);
require(`${__hooks}/routes/sharing/shared.js`);
require(`${__hooks}/routes/sharing/comments.js`);
require(`${__hooks}/routes/sharing/users.js`);
