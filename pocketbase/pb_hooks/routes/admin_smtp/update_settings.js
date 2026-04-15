/// <reference path="../../../pb_data/types.d.ts" />

// Admin endpoint to update SMTP settings
routerAdd("PATCH", "/api/admin/smtp", (c) => {
  const { requireAdmin, parseRequestBody } = require(`${__hooks}/utils.js`)
  
  try {
    // Check if authenticated user is an admin
    requireAdmin(c)
    
    // Parse request body
    const requestData = parseRequestBody(c)
    
    const smtpData = requestData.smtp
    
    if (!smtpData) {
      return c.json(400, { error: "SMTP configuration is required" })
    }

    // Get current settings
    const settings = $app.settings()
    settings.smtp = settings.smtp || {}
    const meta = { ...(settings.meta || {}) }
    
    // Update SMTP settings
    settings.smtp.enabled = !!smtpData.enabled
    
    settings.smtp.host = smtpData.host || ""
    
    settings.smtp.port = parseInt(smtpData.port) || 587
    
    settings.smtp.username = smtpData.username || ""
    
    settings.smtp.authMethod = smtpData.authMethod || "PLAIN"
    
    settings.smtp.tls = smtpData.tls !== false
    
    settings.smtp.localName = smtpData.localName || ""

    // Store sender info in meta to avoid mutating the SMTP host object
    meta.senderName = smtpData.senderName || meta.senderName || "Nana"
    meta.senderAddress = smtpData.senderAddress || meta.senderAddress || ""
    settings.meta = meta
    
    // Only update password if a new one is provided
    if (smtpData.password && smtpData.password !== "") {
      settings.smtp.password = smtpData.password
    }

    // Persist settings to disk so values survive PocketBase restarts
    $app.save(settings)
    
    return c.json(200, { 
      success: true,
      message: "SMTP settings updated successfully"
    })
    
  } catch (err) {
    console.error("Failed to update SMTP settings:", err)
    return c.json(500, { error: "Failed to save SMTP settings: " + String(err) })
  }
}, $apis.requireAuth())
