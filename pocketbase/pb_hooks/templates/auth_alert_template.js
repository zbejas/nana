const { escapeHtml } = require(`${__hooks}/utils.js`);
const { getEmailHeader, getEmailFooter, getTextFooter } = require(`${__hooks}/templates/core/email_layout.js`);

/**
 * Generates HTML and text content for auth alert emails (new device login notifications)
 * @param {Object} params - Template parameters
 * @param {string} params.userName - User's display name
 * @param {string} params.alertInfo - Pre-formatted alert info from PocketBase ({ALERT_INFO})
 * @param {string} [params.siteUrl] - Optional site URL for account security link
 * @returns {Object} Object with html and text properties
 */
function generateAuthAlertContent(params) {

    const userName = escapeHtml(params.userName || "User");
    const alertInfo = params.alertInfo || "";
    const siteUrl = params.siteUrl || "";
    const isTestUrl = !params.siteUrl;

    // Parse structured alert info (Time/IP/Device lines) for rich HTML display
    const timeMatch = alertInfo.match(/Time:\s*(.+)/);
    const ipMatch = alertInfo.match(/IP:\s*(.+)/);
    const deviceMatch = alertInfo.match(/Device:\s*(.+)/);
    const hasParsedDetails = timeMatch || ipMatch || deviceMatch;

    // Build login details HTML
    let loginDetailsHtml;
    if (hasParsedDetails) {
      const rows = [];
      if (timeMatch) rows.push(`
            <tr>
              <td style="padding: 6px 10px; color: #64748b; font-size: 13px; font-weight: 600; vertical-align: top; white-space: nowrap;">Time</td>
              <td style="padding: 6px 10px; color: #334155; font-size: 14px;">${escapeHtml(timeMatch[1])}</td>
            </tr>`);
      if (ipMatch) rows.push(`
            <tr>
              <td style="padding: 6px 10px; color: #64748b; font-size: 13px; font-weight: 600; vertical-align: top; white-space: nowrap;">IP Address</td>
              <td style="padding: 6px 10px; color: #334155; font-size: 14px;">${escapeHtml(ipMatch[1])}</td>
            </tr>`);
      if (deviceMatch) rows.push(`
            <tr>
              <td style="padding: 6px 10px; color: #64748b; font-size: 13px; font-weight: 600; vertical-align: top; white-space: nowrap;">Device</td>
              <td style="padding: 6px 10px; color: #334155; font-size: 14px; word-break: break-word;">${escapeHtml(deviceMatch[1])}</td>
            </tr>`);
      loginDetailsHtml = `
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">${rows.join("")}
          </table>`;
    } else {
      // Fallback: show raw text
      loginDetailsHtml = `<pre style="margin: 6px 0; color: #475569; font-family: inherit; font-size: 14px; white-space: pre-wrap; word-break: break-word;">${escapeHtml(alertInfo)}</pre>`;
    }

    // HTML sections
    const headerHtml = getEmailHeader();

    const greetingHtml = `
        <h2 style="color: #1e293b; margin: 0 0 12px 0; font-size: 22px;">Hello ${userName},</h2>
        <p style="color: #475569; line-height: 1.5; margin: 0 0 14px 0;">We detected a new sign-in to your Nana account.</p>
        
        <div style="background: #fff7ed; border-radius: 8px; padding: 14px; margin: 14px 0; border-left: 4px solid #f97316;">
          <p style="margin: 0; color: #9a3412; font-weight: 600; font-size: 16px;">🔔 New Login Detected</p>
          <p style="margin: 8px 0 0 0; color: #475569; font-size: 14px;">A sign-in was detected from a new device or location.</p>
        </div>
        
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px; margin: 14px 0;">
          <p style="margin: 0 0 12px 0; color: #64748b; font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">Login Details</p>
          ${loginDetailsHtml}
        </div>
        
        <div style="background: #fdf2f8; border-left: 4px solid #ec4899; border-radius: 4px; padding: 12px; margin: 14px 0;">
          <p style="margin: 0; color: #be185d; font-size: 14px; line-height: 1.5;">
            <strong>✓ Was this you?</strong> If you recognize this activity, you can safely ignore this email.
          </p>
        </div>
        
        <div style="background: #fef2f2; border-left: 4px solid #ef4444; border-radius: 4px; padding: 12px; margin: 14px 0;">
          <p style="margin: 0; color: #991b1b; font-size: 14px; line-height: 1.5;">
            <strong>⚠️ Didn't recognize this?</strong> If you didn't sign in, please change your password immediately and contact support.
          </p>
        </div>`;

    const ctaHtml = `
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin: 20px auto;">
          <tr>
            <td style="border-radius: 8px; background: linear-gradient(135deg, #ec4899 0%, #db2777 100%);">
              <a href="${siteUrl}/settings" target="_blank" style="border: 1px solid #ec4899; border-radius: 8px; box-sizing: border-box; color: #ffffff; cursor: pointer; display: inline-block; font-size: 15px; font-weight: 600; margin: 0; padding: 10px 24px; text-decoration: none; text-transform: none;">Review Account Security</a>
            </td>
          </tr>
        </table>
        ${isTestUrl ? `<p style="color: #94a3b8; font-size: 11px; text-align: center; margin: 4px 0 0 0; font-style: italic;">⚠ Test link — configure your site URL in Nana settings</p>` : ""}
    `;

    const footerHtml = getEmailFooter();

    const htmlContent = headerHtml + greetingHtml + ctaHtml + footerHtml;

    // Build plain text version
    const textContent = `Hello ${params.userName || "User"},

We detected a new sign-in to your Nana account.

Login Details:
${params.alertInfo || "No details available."}

If you recognize this activity, you can safely ignore this email.

If you didn't sign in, please change your password immediately and contact support.

Review your account security: ${siteUrl}/settings${isTestUrl ? " (test link — configure site URL in Nana settings)" : ""}

${getTextFooter()}`;

    return {
        html: htmlContent,
        text: textContent,
    };
}

// Export for use in other modules
if (typeof module !== "undefined" && module.exports) {
    module.exports = { generateAuthAlertContent };
}
