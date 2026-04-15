/// <reference path="../../pb_data/types.d.ts" />

// OTP (One-Time Password) hook
onMailerRecordOTPSend((e) => {
  // Load email template helper
  const { generateOTPContent } = require(`${__hooks}/templates/otp_template.js`)
  const { getSenderInfo } = require(`${__hooks}/utils.js`)

  try {
    const settings = $app.settings()
    const smtp = settings.smtp || {}
    const meta = settings.meta || {}
    
    const appName = "Nana"
    const otpCode = e.meta.password // The OTP code
    const userName = e.record.get("name") || e.record.get("email") || "User"
    
    const { senderName, senderAddress } = getSenderInfo()
    
    // Generate email content using template
    const emailContent = generateOTPContent({
      userName,
      otpCode
    })
    
    // Update the message
    e.message.subject = `Your ${appName} login code`
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
    console.error("Failed to customize OTP email:", err)
    // Let the default email be sent on error
    e.next()
  }
})
