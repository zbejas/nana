/// <reference path="../../../pb_data/types.d.ts" />

// Admin endpoint to get SMTP settings
routerAdd("GET", "/api/admin/smtp", (c) => {
  const { requireAdmin } = require(`${__hooks}/utils.js`)
  
  try {
    // Check if authenticated user is an admin
    requireAdmin(c)
    
    // Get current SMTP settings
    const settings = $app.settings()
    const smtp = settings.smtp || {}
    const meta = settings.meta || {}
    
    // Return SMTP settings (without sensitive password)
    return c.json(200, {
      smtp: {
        enabled: smtp.enabled || false,
        host: smtp.host || "",
        port: smtp.port || 587,
        username: smtp.username || "",
        password: "", // Never return the actual password
        authMethod: smtp.authMethod || "PLAIN",
        tls: smtp.tls !== false, // Default to true
        localName: smtp.localName || "",
        senderName: smtp.senderName || meta.senderName || "",
        senderAddress: smtp.senderAddress || meta.senderAddress || "",
      }
    })
    
  } catch (err) {
    console.error("Failed to get SMTP settings:", err)
    return c.json(500, { error: "Failed to load SMTP settings: " + String(err) })
  }
}, $apis.requireAuth())
