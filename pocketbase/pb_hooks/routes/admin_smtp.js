/// <reference path="../../pb_data/types.d.ts" />

// SMTP routes
require(`${__hooks}/routes/admin_smtp/get_settings.js`);
require(`${__hooks}/routes/admin_smtp/update_settings.js`);
require(`${__hooks}/routes/admin_smtp/test_email.js`);
require(`${__hooks}/routes/admin_smtp/send_password.js`);
