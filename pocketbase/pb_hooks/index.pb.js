/// <reference path="../pb_data/types.d.ts" />

// Bootstrap (env seeding)
require(`${__hooks}/bootstrap.js`);

// Document hooks
require(`${__hooks}/documents/calculate_stats.js`);
require(`${__hooks}/documents/create_version.js`);

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
require(`${__hooks}/routes/check_users.js`);
require(`${__hooks}/routes/trash.js`);

// Guard hooks
require(`${__hooks}/guards/user_guards.js`);
require(`${__hooks}/guards/trash_guards.js`);
require(`${__hooks}/guards/version_guards.js`);
