/// <reference path="../../pb_data/types.d.ts" />

// Auth alert hook (new device login notification)
onMailerRecordAuthAlertSend((e) => {
  // Load email template helper
  const { generateAuthAlertContent } = require(`${__hooks}/templates/auth_alert_template.js`)
  const { getSiteUrl, getSenderInfo } = require(`${__hooks}/utils.js`)

  const getRecordField = (fieldName) => {
    try {
      return e.record.get(fieldName)
    } catch (_) {
      return ""
    }
  }

  try {
    const appName = "Nana"
    const userName = getRecordField("name") || getRecordField("email") || "User"

    // PocketBase resolves {ALERT_INFO} into the default e.message before we get it.
    // The default message contains the entire PocketBase email template (CSS, HTML,
    // "Acme" branding, etc.). We only need the login details: timestamp, IP, user agent.
    let alertInfo = ""
    const rawBody = (e.message && e.message.text) || 
                    (e.message && e.message.html ? e.message.html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim() : "")
    
    if (rawBody) {
      // Extract login details: "2026-03-02 21:14:12.051Z - 192.168.5.100 Mozilla/5.0 ..."
      // Pattern: timestamp - IP useragent
      const match = rawBody.match(/(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}[.\dZ]*)\s*-\s*(\S+)\s+(.*?)(?:\s*If this|$)/s)
      if (match) {
        const timestamp = match[1].trim()
        const ip = match[2].trim()
        const userAgent = match[3].trim()
        alertInfo = `Time: ${timestamp}\nIP: ${ip}\nDevice: ${userAgent}`
      } else {
        // Fallback: couldn't parse, use raw but truncate to something reasonable
        alertInfo = rawBody.length > 300 ? rawBody.substring(0, 300) + "..." : rawBody
      }
    }
    
    const siteUrl = getSiteUrl()
    const { senderName, senderAddress } = getSenderInfo()
    
    // Generate email content using template
    const emailContent = generateAuthAlertContent({
      userName,
      alertInfo,
      siteUrl
    })
    
    // Update the message
    e.message.subject = `New sign-in to your ${appName} account`
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
    console.error("Failed to customize auth alert email:", err)
    // Let the default email be sent on error
    e.next()
  }
})
