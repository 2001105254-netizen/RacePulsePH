const LOGO_URL = 'https://racepulseph.com/assets/racepulse-mark-192.png';
const SUPPORT_EMAIL = 'events@racepulseph.com';
const APP_ORIGIN = 'https://racepulseph.com';

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function listUnsubscribeHeaders(email, unsubscribeUrl) {
  const fallbackUrl = `${APP_ORIGIN}/unsubscribe?email=${encodeURIComponent(email)}`;
  const targetUrl = unsubscribeUrl || fallbackUrl;
  return {
    'List-Unsubscribe': `<mailto:${SUPPORT_EMAIL}?subject=unsubscribe>, <${targetUrl}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
}

function accountEmail({ purpose, name, code, logoSource = LOGO_URL, unsubscribeUrl }) {
  const firstName = String(name || 'Runner').trim().split(/\s+/)[0] || 'Runner';
  const signup = purpose === 'verify';
  const heading = signup ? `Welcome to Race Pulse, ${firstName}!` : `Let's get you back on track, ${firstName}.`;
  const instruction = signup ? "Here's your code to verify your account." : "Here's your code to reset your RacePulse password.";
  const label = signup ? 'VERIFY YOUR ACCOUNT' : 'RESET YOUR PASSWORD';
  const unsubLink = unsubscribeUrl || `${APP_ORIGIN}/unsubscribe`;
  const text = `${heading}\n\n${instruction}\n\n${code}\n\nThis code expires in 10 minutes. Use the most recent code and never share it.\n\nHappy running ka Racepulse!\nThe RacePulsePH Team\n${APP_ORIGIN}\n\nIf you didn't request this, you can safely ignore this email. Need help? Contact ${SUPPORT_EMAIL}.\nManage optional email preferences: ${unsubLink}`;
  // Real text keeps branding visible when images are blocked. The HTTPS mark
  // also renders in mail viewers that cannot resolve CID image references.
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><title>${label}</title></head>
<body style="margin:0;padding:0;background:#f5f5f7;font-family:Arial,Helvetica,sans-serif;color:#171719;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(instruction)} Valid for 10 minutes.</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f5f5f7;"><tr><td align="center" style="padding:28px 12px;">
<table role="presentation" width="560" cellspacing="0" cellpadding="0" style="width:100%;max-width:560px;border:1px solid #e4e4e7;border-radius:20px;overflow:hidden;background:#fefefe;">
<tr><td style="padding:24px;background:#0a0a0a;border-radius:20px 20px 0 0;">
<table role="presentation" cellspacing="0" cellpadding="0"><tr>
<td width="64" valign="middle" style="width:64px;padding-right:16px;"><img src="${escapeHtml(logoSource)}" width="64" height="64" alt="RP" style="display:block;width:64px;height:64px;border:0;color:#f5f5f7;font-size:18px;font-weight:bold;"></td>
<td valign="middle"><p style="margin:0;font-size:22px;line-height:1.2;font-weight:700;letter-spacing:-0.6px;color:#f5f5f7;">RacePulse<span style="color:#ff6259;">PH</span></p><p style="margin:7px 0 0;font-size:10px;line-height:1.4;letter-spacing:1.5px;color:#c5c5cb;">EVERY SECOND COUNTS</p></td>
</tr></table></td></tr>
<tr><td style="padding:30px 24px 20px;"><p style="margin:0 0 12px;color:#c22e25;font-size:10px;font-weight:700;letter-spacing:1.8px;line-height:1.5;">${label}</p>
<h1 style="margin:0 0 14px;font-size:26px;line-height:1.25;letter-spacing:-0.7px;overflow-wrap:anywhere;word-break:break-word;">${escapeHtml(heading)}</h1>
<p style="margin:0;color:#52525b;font-size:15px;line-height:1.7;">${escapeHtml(instruction)}</p></td></tr>
<tr><td style="padding:0 24px 24px;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:24px 8px;background:#fff5f4;border:1px solid #ffe1de;border-radius:14px;">
<p style="margin:0 0 12px;color:#9e2019;font-size:10px;font-weight:700;line-height:1.4;letter-spacing:1.5px;">YOUR ONE-TIME CODE</p>
<p style="margin:0;font-family:'Courier New',monospace;font-size:40px;line-height:1.2;font-weight:700;letter-spacing:6px;color:#c22e25;white-space:nowrap;">${escapeHtml(code)}</p></td></tr></table>
<p style="margin:14px 0 0;font-size:12px;line-height:1.7;color:#64646d;">Expires in <strong>10 minutes</strong>. Use your most recent code.<br>Never share this code with anyone.</p></td></tr>
<tr><td style="padding:0 24px 28px;"><p style="margin:0 0 7px;font-size:16px;line-height:1.5;font-weight:700;">Happy running ka Racepulse!</p>
<p style="margin:0;color:#64646d;font-size:12px;line-height:1.7;">The RacePulsePH Team<br><a href="${APP_ORIGIN}" style="color:#c22e25;text-decoration:none;">racepulseph.com</a></p></td></tr>
<tr><td style="padding:18px 24px;border-top:1px solid #edeef0;background:#fafafa;border-radius:0 0 20px 20px;"><p style="margin:0;font-size:11px;line-height:1.7;color:#71717a;">Didn't request this code? You can safely ignore this email.<br>Need help? <a href="mailto:${SUPPORT_EMAIL}" style="color:#52525b;text-decoration:underline;">${SUPPORT_EMAIL}</a> | <a href="${escapeHtml(unsubLink)}" style="color:#52525b;text-decoration:underline;">Manage optional email preferences</a></p></td></tr>
</table></td></tr></table></body></html>`;
  return { subject: signup ? 'Your RacePulse account verification code' : 'Your RacePulse password reset code', text, html };
}

function accountMessage({ sender = SUPPORT_EMAIL, email, purpose, name, code, unsubscribeUrl }) {
  return {
    from: { name: 'RacePulsePH', address: sender },
    to: { address: email },
    replyTo: { name: 'RacePulsePH', address: sender },
    envelope: { from: sender, to: [email] },
    headers: {
      'Auto-Submitted': 'auto-generated',
      'X-Auto-Response-Suppress': 'All',
      ...listUnsubscribeHeaders(email, unsubscribeUrl),
    },
    disableFileAccess: true,
    disableUrlAccess: true,
    ...accountEmail({ purpose, name, code, unsubscribeUrl }),
  };
}

/**
 * Composes optional event announcements with mandatory RFC 8058 one-click unsubscribe headers.
 */
function notificationEmailMessage({ sender = SUPPORT_EMAIL, email, subject, bodyText, unsubscribeUrl }) {
  const safeSubject = String(subject || 'RacePulsePH Race Update').slice(0, 140);
  const safeText = String(bodyText || '');
  const targetUnsubscribe = unsubscribeUrl || `${APP_ORIGIN}/unsubscribe?email=${encodeURIComponent(email)}`;
  const html = `<!doctype html><html lang="en"><body style="margin:0;padding:24px;font-family:Arial,Helvetica,sans-serif;background:#f5f5f7;color:#171719;"><div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e4e4e7;border-radius:16px;padding:24px;"><p style="margin:0 0 12px;font-weight:700;font-size:18px;color:#0a0a0a;">${escapeHtml(safeSubject)}</p><p style="margin:0 0 20px;font-size:14px;line-height:1.7;color:#3f3f46;white-space:pre-line;">${escapeHtml(safeText)}</p><hr style="border:none;border-top:1px solid #e4e4e7;margin:20px 0;"><p style="margin:0;font-size:12px;color:#52525b;">You received this because you opted into optional RacePulsePH event updates.<br><a href="${escapeHtml(targetUnsubscribe)}" style="color:#b91c1c;text-decoration:underline;">Unsubscribe in one click</a> | Contact <a href="mailto:${SUPPORT_EMAIL}" style="color:#52525b;">${SUPPORT_EMAIL}</a></p></div></body></html>`;
  return {
    from: { name: 'RacePulsePH', address: sender },
    to: { address: email },
    replyTo: { name: 'RacePulsePH', address: sender },
    envelope: { from: sender, to: [email] },
    headers: {
      ...listUnsubscribeHeaders(email, targetUnsubscribe),
    },
    disableFileAccess: true,
    disableUrlAccess: true,
    subject: safeSubject,
    text: `${safeText}\n\nUnsubscribe without logging in: ${targetUnsubscribe}\nSupport: ${SUPPORT_EMAIL}`,
    html,
  };
}

module.exports = {
  accountEmail,
  accountMessage,
  notificationEmailMessage,
  listUnsubscribeHeaders,
  LOGO_URL,
  SUPPORT_EMAIL,
};
