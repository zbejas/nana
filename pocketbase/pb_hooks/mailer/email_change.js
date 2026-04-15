/// <reference path="../../pb_data/types.d.ts" />

// Email change confirmation hook
onMailerRecordEmailChangeSend((e) => {
  // Load email template helper
  const { generateEmailChangeContent } = require(`${__hooks}/templates/email_change_template.js`)
  const { getSiteUrl, getSenderInfo } = require(`${__hooks}/utils.js`)

  try {
    const appName = "Nana"
    const token = e.meta.token
    const newEmail = e.meta.newEmail
    const userName = e.record.get("name") || e.record.get("email") || "User"

    const siteUrl = getSiteUrl()
    const confirmUrl = siteUrl ? `${siteUrl}/confirm-email-change?token=${encodeURIComponent(token)}` : ""

    const { senderName, senderAddress } = getSenderInfo()
    
    // Generate email content using template
    const emailContent = generateEmailChangeContent({
      userName,
      newEmail,
      confirmUrl
    })
    
    // Update the message
    e.message.subject = `Confirm your new email address for ${appName}`
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
    console.error("Failed to customize email change confirmation content:", err)
    // Let the default email be sent on error
    e.next()
  }
})
