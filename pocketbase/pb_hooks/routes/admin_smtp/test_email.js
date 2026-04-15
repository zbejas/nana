/// <reference path="../../../pb_data/types.d.ts" />

// Admin endpoint to send a test SMTP email
routerAdd("POST", "/api/admin/smtp/test", (c) => {
  // Load email template helper
  const { generateSmtpTestContent } = require(`${__hooks}/templates/smtp_test_template.js`)
  const { requireAdmin, getSiteUrl, getSenderInfo } = require(`${__hooks}/utils.js`)

  try {
    // Admin check
    requireAdmin(c)

    const authRecord = c.auth
    const toRaw = authRecord.get("email") || authRecord.email || ""
    const to = String(toRaw || "").trim()
    if (!to || !to.includes("@")) {
      return c.json(400, { error: "Admin email not found or invalid" })
    }

    const { senderName, senderAddress } = getSenderInfo()

    if (!senderAddress || !senderAddress.includes("@")) {
      return c.json(400, { error: "Sender address is not configured" })
    }

    const siteUrl = getSiteUrl()

    const mailer = $app.newMailClient()
    
    // Generate email content using template
    const emailContent = generateSmtpTestContent({
      siteUrl
    })
    
    const message = new MailerMessage({
      from: {
        address: senderAddress,
        name: senderName,
      },
      to: [{ address: to }],
      subject: "SMTP Test - Nana",
      text: emailContent.text,
      html: emailContent.html,
    })

    mailer.send(message)

    return c.json(200, { success: true, message: "Test email sent (check inbox)" })
  } catch (err) {
    console.error("Failed to send test email:", err)
    return c.json(500, { error: "Failed to send test email: " + String(err) })
  }
}, $apis.requireAuth())
