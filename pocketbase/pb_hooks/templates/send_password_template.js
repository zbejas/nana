const { escapeHtml } = require(`${__hooks}/utils.js`);
const { getEmailHeader, getEmailFooter, getTextFooter } = require(`${__hooks}/templates/core/email_layout.js`);

/**
 * Generates HTML and text content for sending password to user emails
 * @param {Object} params - Template parameters
 * @param {string} params.userName - User's display name
 * @param {string} params.userEmail - User's email address
 * @param {string} params.password - User's password
 * @param {string} [params.siteUrl] - Optional site URL for login link
 * @returns {Object} Object with html and text properties
 */
function generateSendPasswordContent(params) {
    const userName = escapeHtml(params.userName || "User");
    const userEmail = escapeHtml(params.userEmail || "");
    const password = escapeHtml(params.password || "");
  const siteUrl = params.siteUrl || "";
    const isTestUrl = !params.siteUrl;

    // HTML sections
    const headerHtml = getEmailHeader();

    const greetingHtml = `
        <h2 style="color: #1e293b; margin: 0 0 12px 0; font-size: 22px;">Hello ${userName},</h2>
        <p style="color: #475569; line-height: 1.5; margin: 0 0 14px 0;">Welcome to Nana! Your account password has been set.</p>
        
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px; margin: 14px 0;">
          <p style="margin: 0 0 12px 0; color: #64748b; font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">Login Credentials</p>
          <p style="margin: 6px 0;"><strong style="color: #1e293b;">Email:</strong> <span style="color: #475569;">${userEmail}</span></p>
          <p style="margin: 6px 0;"><strong style="color: #1e293b;">Password:</strong> <code style="background: #fff; padding: 4px 10px; border-radius: 4px; color: #ec4899; font-family: 'Courier New', monospace; border: 1px solid #e2e8f0;">${password}</code></p>
        </div>
        
        <div style="background: #fff7ed; border-left: 4px solid #f97316; border-radius: 4px; padding: 12px; margin: 14px 0;">
          <p style="margin: 0; color: #9a3412; font-size: 14px; line-height: 1.5;">
            <strong>🔒 Security Note:</strong> Please keep this information secure and consider changing your password after your first login.
          </p>
        </div>`;

    const ctaHtml = `
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin: 20px auto;">
          <tr>
            <td style="border-radius: 8px; background: linear-gradient(135deg, #ec4899 0%, #db2777 100%);">
              <a href="${siteUrl}" target="_blank" style="border: 1px solid #ec4899; border-radius: 8px; box-sizing: border-box; color: #ffffff; cursor: pointer; display: inline-block; font-size: 15px; font-weight: 600; margin: 0; padding: 10px 24px; text-decoration: none; text-transform: none;">Go to Nana</a>
            </td>
          </tr>
        </table>
        ${isTestUrl ? `<p style="color: #94a3b8; font-size: 11px; text-align: center; margin: 4px 0 0 0; font-style: italic;">⚠ Test link — configure your site URL in Nana settings</p>` : ""}
    `;

    const footerHtml = getEmailFooter();

    const htmlContent = headerHtml + greetingHtml + ctaHtml + footerHtml;

    // Build plain text version
    const textContent = `Hello ${params.userName || "User"},

Welcome to Nana! Your account password has been set.

Email: ${params.userEmail}
Password: ${params.password}

Please keep this information secure and consider changing your password after logging in.

Go to Nana: ${siteUrl}${isTestUrl ? " (test link — configure site URL in Nana settings)" : ""}

${getTextFooter()}`;

    return {
        html: htmlContent,
        text: textContent,
    };
}

// Export for use in other modules
if (typeof module !== "undefined" && module.exports) {
    module.exports = { generateSendPasswordContent };
}
