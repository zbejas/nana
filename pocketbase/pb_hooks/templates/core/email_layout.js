/**
 * Core email layout components shared across all email templates.
 * Provides a consistent header and footer for all Nana emails.
 */

/**
 * Returns the HTML email header.
 * Includes the outer wrapper, branding header, and opens the content section.
 * @returns {string} HTML string
 */
function getEmailHeader() {
    return `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 16px; background: #ffffff;">
      <!-- Header -->
      <div style="text-align: center; padding: 14px 0; border-bottom: 2px solid #ec4899;">
        <h1 style="margin: 0; color: #ec4899; font-size: 28px; font-weight: 700;">Nana</h1>
        <p style="margin: 3px 0 0 0; color: #64748b; font-size: 13px;">Not Another Notes App</p>
      </div>
      
      <!-- Content -->
      <div style="padding: 20px 0;">`;
}

/**
 * Returns the HTML email footer.
 * Closes the content section, adds the footer, and closes the outer wrapper.
 * @returns {string} HTML string
 */
function getEmailFooter() {
    return `
      </div>
      
      <!-- Footer -->
      <div style="border-top: 1px solid #e2e8f0; padding-top: 14px; margin-top: 20px; text-align: center;">
        <p style="color: #94a3b8; margin: 0; font-size: 13px;">Best regards,<br><strong>Nana</strong></p>
      </div>
    </div>`;
}

/**
 * Returns the plain text email footer.
 * @returns {string} Plain text string
 */
function getTextFooter() {
    return `Best regards,\nNana`;
}

// Export for use in other modules
if (typeof module !== "undefined" && module.exports) {
    module.exports = { getEmailHeader, getEmailFooter, getTextFooter };
}
