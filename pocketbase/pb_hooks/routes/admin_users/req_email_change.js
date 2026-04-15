/// <reference path="../../../pb_data/types.d.ts" />

// Admin route to request email change for other users
routerAdd(
  "POST",
  "/api/admin/users/{id}/request-email-change",
  (e) => {
    // Load email template helper and utils
    const { generateEmailChangeContent } = require(`${__hooks}/templates/email_change_template.js`)
    const { requireAdmin, parseRequestBody, getSiteUrl, getSenderInfo } = require(`${__hooks}/utils.js`)
    
    try {
      // Check admin access
      requireAdmin(e)
      
      // Get user ID from path parameter
      const userId = e.request.pathValue("id")
      if (!userId) {
        throw new BadRequestError("User ID is required")
      }
      
      // Parse request body
      const requestData = parseRequestBody(e)
      
      const newEmail = requestData.newEmail
      if (!newEmail) {
        throw new BadRequestError("New email is required")
      }
      
      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
      if (!emailRegex.test(newEmail)) {
        throw new BadRequestError("Invalid email format")
      }
      
      // Find the user record
      const record = $app.findRecordById("users", userId)
      
      // Check if email is already in use using safe filter placeholders
      try {
        const existingUser = $app.findFirstRecordByFilter(
          "users",
          "email = {:email}",
          { email: newEmail }
        )
        if (existingUser && existingUser.id !== userId) {
          throw new BadRequestError("Email is already in use")
        }
      } catch (err) {
        // findFirstRecordByFilter throws when not found; that's fine
      }
      
      // Generate email-change token (documented JS API)
      const token = record.newEmailChangeToken(newEmail)
      
      const siteUrl = getSiteUrl()
      
      // Build confirmation URL for your frontend
      const confirmUrl = siteUrl 
        ? `${siteUrl}/confirm-email-change?token=${encodeURIComponent(token)}`
        : ""
      
      const userName = record.get("name") || record.get("email") || "User"
      
      // Generate email content using shared template
      const emailContent = generateEmailChangeContent({
        userName,
        newEmail,
        confirmUrl
      })
      
      // Build and send confirmation email manually
      const { senderName, senderAddress } = getSenderInfo()
      
      const message = new MailerMessage({
        from: {
          address: senderAddress,
          name: senderName,
        },
        to: [{ address: newEmail }],
        subject: "Confirm your new email address for Nana",
        html: emailContent.html,
        text: emailContent.text,
      })
      
      // Send the email via configured SMTP
      $app.newMailClient().send(message)
      
      // Optionally update email visibility
      record.set("emailVisibility", true)
      $app.save(record)
      
      return e.json(200, { 
        message: "Email change request sent successfully",
        newEmail: newEmail
      })
      
    } catch (err) {
      console.error("Failed to request email change:", err)
      // Handle known error types
      if (err instanceof BadRequestError || err instanceof ForbiddenError) {
        return e.json(err.status, { error: err.message })
      }
      return e.json(500, { error: "Failed to request email change: " + String(err) })
    }
  },
  $apis.requireAuth()
)
