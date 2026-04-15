/// <reference path="../../pb_data/types.d.ts" />

// Password reset hook
onMailerRecordPasswordResetSend((e) => {
  // Load email template helper
  const { generatePasswordResetContent } = require(`${__hooks}/templates/password_reset_template.js`)
  const { getSiteUrl, getSenderInfo } = require(`${__hooks}/utils.js`)

  try {
    const appName = "Nana"
    const token = e.meta.token
    const userName = e.record.get("name") || e.record.get("email") || "User"

    const siteUrl = getSiteUrl()
    const resetUrl = siteUrl ? `${siteUrl}/reset-password?token=${encodeURIComponent(token)}` : ""

    const { senderName, senderAddress } = getSenderInfo()
    
    // Generate email content using template
    const emailContent = generatePasswordResetContent({
      userName,
      resetUrl
    })
    
    // Update the message
    e.message.subject = `Reset your ${appName} password`
    e.message.html = emailContent.html
    e.message.text = emailContent.text
    
    // Override sender if configured
    if (senderAddress) {
      e.message.from = {
        address: senderAddress,
        name: senderName,
      }
    }
    
    // Send the modified message
    e.next()
  } catch (err) {
    console.error("Failed to customize password reset email content:", err)
    // Let the default email be sent on error
    e.next()
  }
})
