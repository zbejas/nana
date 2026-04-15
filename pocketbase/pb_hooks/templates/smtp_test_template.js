const { getEmailHeader, getEmailFooter, getTextFooter } = require(`${__hooks}/templates/core/email_layout.js`);

/**
 * Generates HTML and text content for SMTP test emails
 * @param {Object} params - Template parameters
 * @param {string} [params.siteUrl] - Optional site URL for link
 * @returns {Object} Object with html and text properties
 */
function generateSmtpTestContent(params) {
  const siteUrl = params.siteUrl || "";
    const isTestUrl = !params.siteUrl;

    // HTML sections
    const headerHtml = getEmailHeader();

    const mainHtml = `
        <h2 style="color: #1e293b; margin: 0 0 12px 0; font-size: 22px;">Hello,</h2>
        <p style="color: #475569; line-height: 1.5; margin: 0 0 14px 0;">This is a test email from your Nana notes app.</p>
        
        <div style="background: #fdf2f8; border-radius: 8px; padding: 14px; margin: 14px 0; border-left: 4px solid #ec4899;">
          <p style="margin: 0; color: #be185d; font-weight: 600; font-size: 16px;">✓ SMTP Configuration Test Successful</p>
          <p style="margin: 8px 0 0 0; color: #475569; font-size: 14px;">If you received this email, your SMTP settings are configured correctly!</p>
        </div>
        
        <p style="color: #475569; line-height: 1.5; margin: 14px 0;">You can now send emails to your users.</p>`;

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

    const htmlContent = headerHtml + mainHtml + ctaHtml + footerHtml;

    // Build plain text version
    const textContent = `Hello,

This is a test email from your Nana notes app.

If you received this email, your SMTP settings are configured correctly!

Go to Nana: ${siteUrl}${isTestUrl ? " (test link — configure site URL in Nana settings)" : ""}

${getTextFooter()}`;

    return {
        html: htmlContent,
        text: textContent,
    };
}

// Export for use in other modules
if (typeof module !== "undefined" && module.exports) {
    module.exports = { generateSmtpTestContent };
}
