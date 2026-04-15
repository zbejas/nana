/// <reference path="../pb_data/types.d.ts" />

/**
 * Sanitizes a URL by trimming, removing quotes, and trailing slashes
 * @param {string} url - URL to sanitize
 * @returns {string} Sanitized URL
 */
function sanitizeUrl(url) {
  if (!url) return ""
  let cleaned = String(url).trim()
  cleaned = cleaned.replace(/^["']|["']$/g, "")
  cleaned = cleaned.trim()
  cleaned = cleaned.replace(/\/+$/, "")
  return cleaned
}

/**
 * Escapes HTML special characters to prevent XSS
 * @param {string} text - Text to escape
 * @returns {string} Escaped text
 */
function escapeHtml(text) {
  if (!text) return ""
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

/**
 * Checks if the authenticated user is an admin
 * @param {any} context - The route context (c or e)
 * @returns {boolean} True if user is admin
 * @throws {ForbiddenError} If user is not authenticated or not admin
 */
function requireAdmin(context) {
  const authRecord = context.auth
  
  if (!authRecord) {
    console.error("No authenticated user")
    throw new UnauthorizedError("Authentication required")
  }
  
  const isAdmin = authRecord.get("admin")
  if (!isAdmin) {
    throw new ForbiddenError("Admin access required")
  }
  
  return true
}

/**
 * Parses request body from PocketBase context, handling both pre-parsed and raw body
 * @param {any} context - The route context (c or e)
 * @returns {any} Parsed request data
 * @throws {BadRequestError} If body is missing or invalid JSON
 */
function parseRequestBody(context) {
  const reqInfo = context.requestInfo()
  let requestData = reqInfo?.body || null

  if (typeof requestData === "string" && requestData.trim() !== "") {
    try {
      requestData = JSON.parse(requestData)
    } catch (parseErr) {
      console.error("Invalid JSON payload", parseErr)
      throw new BadRequestError("Invalid JSON payload")
    }
  }

  if (!requestData) {
    const rawBody = toString(context.body || "")
    if (!rawBody || rawBody.trim() === "") {
      throw new BadRequestError("Request body is required")
    }

    try {
      requestData = JSON.parse(rawBody)
    } catch (parseErr) {
      console.error("Invalid JSON payload", parseErr)
      throw new BadRequestError("Invalid JSON payload")
    }
  }

  return requestData
}

/**
 * Gets the site URL from settings database
 * @returns {string} Sanitized site URL or empty string
 */
function getSiteUrl() {
  try {
    const siteUrlRecord = $app.findFirstRecordByFilter("settings", "key = 'site_url'")
    const value = siteUrlRecord.get("value")

    if (!value) return ""

    if (typeof value === "object") {
      // PocketBase may expose JSONField values as byte-array-like objects
      // (e.g. {0:123,1:34,...}) instead of plain JS objects.
      const asBytes = (() => {
        try {
          const numericKeys = Object.keys(value)
            .filter((key) => /^\d+$/.test(key))
            .sort((a, b) => Number(a) - Number(b))

          if (numericKeys.length === 0) return []
          return numericKeys.map((key) => Number(value[key]))
        } catch (_) {
          return []
        }
      })()

      if (asBytes.length > 0) {
        const decoded = String.fromCharCode.apply(null, asBytes)
        const decodedSanitized = sanitizeUrl(decoded)

        try {
          const parsed = JSON.parse(decoded)
          if (parsed && typeof parsed === "object") {
            const sanitized = sanitizeUrl(parsed.url || parsed.siteUrl || "")
            return sanitized
          }
        } catch (_) {
        }

        return decodedSanitized
      }

      const directUrl = sanitizeUrl((value && (value.url || value.siteUrl)) || "")
      const getterUrl = sanitizeUrl(
        value && typeof value.get === "function"
          ? (value.get("url") || value.get("siteUrl") || "")
          : ""
      )
      const sanitized = directUrl || getterUrl

      return sanitized
    }

    if (typeof value === "string") {
      const trimmed = value.trim()
      if (!trimmed) return ""

      try {
        const parsed = JSON.parse(trimmed)
        if (parsed && typeof parsed === "object") {
          const sanitized = sanitizeUrl(parsed.url || parsed.siteUrl || "")
          return sanitized
        }
      } catch (parseErr) {
      }

      const sanitized = sanitizeUrl(trimmed)
      return sanitized
    }

    return ""
  } catch (err) {
    // Settings record doesn't exist yet
    return ""
  }
}

/**
 * Gets email sender information from app settings
 * @returns {Object} Object containing senderName and senderAddress
 */
function getSenderInfo() {
  const settings = $app.settings()
  const smtp = settings.smtp || {}
  const meta = settings.meta || {}
  
  const senderName = meta.senderName || smtp.senderName || "Nana"
  const senderAddress = String(meta.senderAddress || smtp.senderAddress || smtp.username || "").trim()
  
  return { senderName, senderAddress }
}

/**
 * Checks whether an auth record has the verified flag set
 * @param {any} authRecord - The auth record (e.auth or c.auth)
 * @returns {boolean}
 */
function isVerifiedUser(authRecord) {
  if (!authRecord) return false;
  return authRecord.get("verified") === true;
}

/**
 * Returns true when at least one user exists in the collection,
 * optionally excluding a specific record by ID (useful in after-create hooks).
 * @param {string} [excludeId] - Optional record ID to exclude
 * @returns {boolean}
 */
function hasExistingUsers(excludeId) {
  const filter = excludeId ? `id != "${excludeId}"` : "";
  const existing = $app.findRecordsByFilter("users", filter, "-created", 1);
  return existing.length > 0;
}

// Export for use in other modules
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    sanitizeUrl,
    escapeHtml,
    requireAdmin,
    parseRequestBody,
    getSiteUrl,
    getSenderInfo,
    isVerifiedUser,
    hasExistingUsers,
  }
}
