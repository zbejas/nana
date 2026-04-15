const { escapeHtml } = require(`${__hooks}/utils.js`);
const { getEmailHeader, getEmailFooter, getTextFooter } = require(`${__hooks}/templates/core/email_layout.js`);

/**
 * Generates HTML and text content for OTP (One-Time Password) emails
 * @param {Object} params - Template parameters
 * @param {string} params.userName - User's display name
 * @param {string} params.otpCode - The one-time password code
 * @returns {Object} Object with html and text properties
 */
function generateOTPContent(params) {
    const userName = escapeHtml(params.userName || "User");
    const otpCode = escapeHtml(params.otpCode || "000000");
    const isTestCode = !params.otpCode;

    // HTML sections
    const headerHtml = getEmailHeader();

    const mainHtml = `
        <h2 style="color: #1e293b; margin: 0 0 12px 0; font-size: 22px;">Hello ${userName},</h2>
        <p style="color: #475569; line-height: 1.5; margin: 0 0 14px 0;">You requested a one-time password to sign in to your Nana account.</p>
        
        <div style="background: #fdf2f8; border-radius: 8px; padding: 14px; margin: 14px 0; border-left: 4px solid #ec4899;">
          <p style="margin: 0; color: #be185d; font-weight: 600; font-size: 16px;">🔑 Your One-Time Password</p>
          <p style="margin: 10px 0 6px 0; color: #475569; font-size: 14px;">Use the code below to complete your sign-in:</p>
          <div style="background: #ffffff; border: 2px solid #ec4899; border-radius: 8px; padding: 12px; text-align: center; margin: 8px 0 0 0;">
            <code style="color: #ec4899; font-size: 28px; font-weight: 700; font-family: 'Courier New', monospace; letter-spacing: 3px;">${otpCode}</code>
          </div>
          ${isTestCode ? `<p style="color: #94a3b8; font-size: 11px; text-align: center; margin: 8px 0 0 0; font-style: italic;">⚠ Sample code — actual OTP will appear here</p>` : ""}
        </div>
        
        <div style="background: #fff7ed; border-left: 4px solid #f97316; border-radius: 4px; padding: 12px; margin: 14px 0;">
          <p style="margin: 0; color: #9a3412; font-size: 14px; line-height: 1.5;">
            <strong>⏱️ Important:</strong> This code will expire soon. If you didn't request this code, please ignore this email.
          </p>
        </div>`;

    const footerHtml = getEmailFooter();

    const htmlContent = headerHtml + mainHtml + footerHtml;

    // Build plain text version
    const textContent = `Hello ${params.userName || "User"},

You requested a one-time password to sign in to your Nana account.

Your one-time code: ${otpCode}${isTestCode ? " (sample — actual OTP will appear here)" : ""}

This code will expire soon. If you didn't request this code, please ignore this email.

${getTextFooter()}`;

    return {
        html: htmlContent,
        text: textContent,
    };
}

// Export for use in other modules
if (typeof module !== "undefined" && module.exports) {
    module.exports = { generateOTPContent };
}
