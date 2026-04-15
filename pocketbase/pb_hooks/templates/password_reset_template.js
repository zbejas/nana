const { escapeHtml } = require(`${__hooks}/utils.js`);
const { getEmailHeader, getEmailFooter, getTextFooter } = require(`${__hooks}/templates/core/email_layout.js`);

/**
 * Generates HTML and text content for password reset emails
 * @param {Object} params - Template parameters
 * @param {string} params.userName - User's display name
 * @param {string} [params.resetUrl] - Optional password reset URL
 * @returns {Object} Object with html and text properties
 */
function generatePasswordResetContent(params) {
    const userName = escapeHtml(params.userName || "User");
  const resetUrl = params.resetUrl || "";
    const isTestUrl = !params.resetUrl;

    // HTML sections
    const headerHtml = getEmailHeader();

    const greetingHtml = `
        <h2 style="color: #1e293b; margin: 0 0 12px 0; font-size: 22px;">Hello ${userName},</h2>
        <p style="color: #475569; line-height: 1.5; margin: 0 0 14px 0;">We received a request to reset your Nana account password.</p>
        
        <div style="background: #fdf2f8; border-radius: 8px; padding: 14px; margin: 14px 0; border-left: 4px solid #ec4899;">
          <p style="margin: 0; color: #be185d; font-weight: 600; font-size: 16px;">🔒 Password Reset Request</p>
          <p style="margin: 8px 0 0 0; color: #475569; font-size: 14px;">Click the button below to create a new password for your account.</p>
        </div>`;

    const ctaHtml = `
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin: 20px auto;">
          <tr>
            <td style="border-radius: 8px; background: linear-gradient(135deg, #ec4899 0%, #db2777 100%);">
              <a href="${resetUrl}" target="_blank" style="border: 1px solid #ec4899; border-radius: 8px; box-sizing: border-box; color: #ffffff; cursor: pointer; display: inline-block; font-size: 15px; font-weight: 600; margin: 0; padding: 10px 24px; text-decoration: none; text-transform: none;">Reset Password</a>
            </td>
          </tr>
        </table>
        ${isTestUrl ? `<p style="color: #94a3b8; font-size: 11px; text-align: center; margin: 4px 0 12px 0; font-style: italic;">⚠ Test link — configure your site URL in Nana settings</p>` : `<p style="color: #64748b; font-size: 13px; text-align: center; margin: 12px 0;">Or copy and paste this link into your browser:<br><a href="${resetUrl}" style="color: #ec4899; word-break: break-all;">${resetUrl}</a></p>`}
    `;

    const securityNoteHtml = `
        <div style="background: #fff7ed; border-left: 4px solid #f97316; border-radius: 4px; padding: 12px; margin: 14px 0;">
          <p style="margin: 0; color: #9a3412; font-size: 14px; line-height: 1.5;">
            <strong>⚠️ Security Note:</strong> If you didn't request this password reset, please ignore this email and your password will remain unchanged.
          </p>
        </div>`;

    const footerHtml = getEmailFooter();

    const htmlContent = headerHtml + greetingHtml + ctaHtml + securityNoteHtml + footerHtml;

    // Build plain text version
    const textContent = `Hello ${params.userName || "User"},

We received a request to reset your Nana account password.

Reset your password here: ${resetUrl}${isTestUrl ? " (test link — configure site URL in Nana settings)" : ""}

If you didn't request this password reset, please ignore this email and your password will remain unchanged.

${getTextFooter()}`;

    return {
        html: htmlContent,
        text: textContent,
    };
}

// Export for use in other modules
if (typeof module !== "undefined" && module.exports) {
    module.exports = { generatePasswordResetContent };
}
