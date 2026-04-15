const { escapeHtml } = require(`${__hooks}/utils.js`);
const { getEmailHeader, getEmailFooter, getTextFooter } = require(`${__hooks}/templates/core/email_layout.js`);

/**
 * Generates HTML and text content for email change confirmation emails
 * @param {Object} params - Template parameters
 * @param {string} params.userName - User's display name
 * @param {string} params.newEmail - New email address to confirm
 * @param {string} params.confirmUrl - Full URL for confirmation
 * @returns {Object} Object with html and text properties
 */
function generateEmailChangeContent(params) {
    const userName = escapeHtml(params.userName || "User");
    const newEmail = escapeHtml(params.newEmail || "");
  const confirmUrl = params.confirmUrl || "";
    const isTestUrl = !params.confirmUrl;

    // HTML sections
    const headerHtml = getEmailHeader();

    const greetingHtml = `
      <h2 style="color: #1e293b; margin: 0 0 12px 0; font-size: 22px;">Hello ${userName},</h2>
      <p style="color: #475569; line-height: 1.5; margin: 0 0 14px 0;">You recently requested to change your email address on Nana.</p>
      
      <div style="background: #fdf2f8; border-radius: 8px; padding: 14px; margin: 14px 0; border-left: 4px solid #ec4899;">
        <p style="margin: 0; color: #be185d; font-weight: 600; font-size: 16px;">📧 Email Change Confirmation</p>
        <p style="margin: 8px 0 0 0; color: #475569; font-size: 14px;">Please confirm that you want to change your email address to:</p>
        <p style="margin: 8px 0 0 0; color: #1e293b; font-weight: 600; font-size: 15px;">${newEmail}</p>
      </div>`;

    const ctaHtml = `
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin: 20px auto;">
        <tr>
          <td style="border-radius: 8px; background: linear-gradient(135deg, #ec4899 0%, #db2777 100%);">
            <a href="${confirmUrl}" target="_blank" style="border: 1px solid #ec4899; border-radius: 8px; box-sizing: border-box; color: #ffffff; cursor: pointer; display: inline-block; font-size: 15px; font-weight: 600; margin: 0; padding: 10px 24px; text-decoration: none; text-transform: none;">Confirm Email Change</a>
          </td>
        </tr>
      </table>
      ${isTestUrl ? `<p style="color: #94a3b8; font-size: 11px; text-align: center; margin: 4px 0 12px 0; font-style: italic;">⚠ Test link — configure your site URL in Nana settings</p>` : `<p style="color: #64748b; font-size: 13px; text-align: center; margin: 12px 0;">Or copy and paste this link into your browser:<br><a href="${confirmUrl}" style="color: #ec4899; word-break: break-all;">${confirmUrl}</a></p>`}
    `;

    const securityNoteHtml = `
      <div style="background: #fff7ed; border-left: 4px solid #f97316; border-radius: 4px; padding: 12px; margin: 14px 0;">
        <p style="margin: 0; color: #9a3412; font-size: 14px; line-height: 1.5;">
          <strong>⚠️ Security Note:</strong> If you didn't request this email change, please ignore this email and your email address will remain unchanged.
        </p>
      </div>`;

    const footerHtml = getEmailFooter();

    const htmlContent = headerHtml + greetingHtml + ctaHtml + securityNoteHtml + footerHtml;

    // Build plain text version
    const textContent = `Hello ${params.userName || "User"},

You recently requested to change your email address on Nana.

Please confirm that you want to change your email address to: ${params.newEmail}

Confirm email change here: ${confirmUrl}${isTestUrl ? " (test link — configure site URL in Nana settings)" : ""}

If you didn't request this email change, please ignore this email and your email address will remain unchanged.

${getTextFooter()}`;

    return {
        html: htmlContent,
        text: textContent,
    };
}

// Export for use in other modules
if (typeof module !== "undefined" && module.exports) {
    module.exports = { generateEmailChangeContent };
}
