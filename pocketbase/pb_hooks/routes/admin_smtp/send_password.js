/// <reference path="../../../pb_data/types.d.ts" />

// Admin endpoint to send password to user via email
routerAdd("POST", "/api/admin/smtp/send-password", (c) => {
  // Load email template helper
  const { generateSendPasswordContent } = require(`${__hooks}/templates/send_password_template.js`)
  const { requireAdmin, parseRequestBody, getSiteUrl, getSenderInfo } = require(`${__hooks}/utils.js`)

  try {
    // Admin check
    requireAdmin(c)

    // Parse request body
    const requestData = parseRequestBody(c)

    const userEmail = requestData.email
    const password = requestData.password
    const userName = requestData.name || "User"

    if (!userEmail || !userEmail.includes("@")) {
      return c.json(400, { error: "Valid user email is required" })
    }

    if (!password) {
      return c.json(400, { error: "Password is required" })
    }

    // Check if SMTP is configured
    const settings = $app.settings()
    const smtp = settings.smtp || {}

    if (!smtp.enabled) {
      return c.json(400, { error: "SMTP is not enabled. Please configure SMTP settings first." })
    }

    const { senderName, senderAddress } = getSenderInfo()

    if (!senderAddress || !senderAddress.includes("@")) {
      return c.json(400, { error: "Sender address is not configured" })
    }

    const siteUrl = getSiteUrl()

    // Send the password email
    const mailer = $app.newMailClient()
    
    // Generate email content using template
    const emailContent = generateSendPasswordContent({
      userName,
      userEmail,
      password,
      siteUrl
    })
    
    const message = new MailerMessage({
      from: {
        address: senderAddress,
        name: senderName,
      },
      to: [{ address: userEmail }],
      subject: "Your Nana Account Password",
      text: emailContent.text,
      html: emailContent.html,
    })

    mailer.send(message)

    return c.json(200, { success: true, message: "Password email sent successfully" })
  } catch (err) {
    console.error("Failed to send password email:", err)
    return c.json(500, { error: "Failed to send password email: " + String(err) })
  }
}, $apis.requireAuth())
