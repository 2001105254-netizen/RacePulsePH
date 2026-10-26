const admin = require('firebase-admin');
const nodemailer = require('nodemailer');
const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret, defineString } = require('firebase-functions/params');
const { createAccountSecurity, AccountError } = require('./account-security');
const { accountMessage } = require('./account-email');

const smtpPassword = defineSecret('SMTP_APP_PASSWORD');
const codeSecret = defineSecret('AUTH_CODE_SECRET');
const smtpUser = defineString('SMTP_USER', { default: 'events@racepulseph.com' });

exports.accountApi = onRequest({
  region: 'asia-southeast1',
  secrets: [smtpPassword, codeSecret],
  cors: ['https://racepulseph.com', 'https://www.racepulseph.com', 'https://racepulseph.web.app', 'https://racepulseph.firebaseapp.com', 'http://localhost', 'https://localhost', 'capacitor://localhost', 'http://localhost:3000', 'http://localhost:5173', 'http://127.0.0.1:3000', 'http://127.0.0.1:5173'],
  maxInstances: 10,
}, async (request, response) => {
  response.set('Cache-Control', 'no-store');
  if (request.method !== 'POST') return response.status(405).json({ error: 'Use POST for account requests.' });
  if (!request.is('application/json') || (request.rawBody?.length || 0) > 8192) return response.status(400).json({ error: 'Invalid account request.' });
  const route = (request.path || '/').replace(/\/+$/, '');
  try {
    const auth = admin.auth();
    const service = createAccountSecurity({
      db: admin.firestore(), auth, secret: codeSecret.value(),
      sendCode: async ({ email, name, purpose, code }) => {
        const transporter = nodemailer.createTransport({
          host: 'smtp.gmail.com', port: 465, secure: true,
          auth: { user: smtpUser.value(), pass: smtpPassword.value().replace(/\s/g, '') },
          connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 30000,
          logger: false, debug: false,
        });
        await transporter.sendMail(accountMessage({ sender: smtpUser.value(), email, purpose, name, code }));
      },
    });
    const input = { ...request.body, ip: request.ip, uid: undefined };
    if (route.startsWith('/verification/')) {
      const token = request.get('Authorization')?.match(/^Bearer (.+)$/)?.[1];
      if (!token) throw new AccountError(401, 'Please sign in again to verify your email.');
      try { input.uid = (await auth.verifyIdToken(token, true)).uid; }
      catch { throw new AccountError(401, 'Your session has expired. Please sign in again.'); }
      input.purpose = 'verify';
    } else {
      input.purpose = 'reset';
    }
    let result;
    if (route === '/verification/request' || route === '/password/request') result = await service.requestCode(input);
    else if (route === '/verification/confirm' || route === '/password/confirm') result = await service.checkCode(input);
    else if (route === '/password/complete') result = await service.resetPassword(input);
    else return response.status(404).json({ error: 'Account route not found.' });
    return response.json(result);
  } catch (error) {
    if (error instanceof AccountError) {
      if (error.retryAfter) response.set('Retry-After', String(error.retryAfter));
      return response.status(error.status).json({ error: error.message, ...(error.retryAfter ? { retryAfter: error.retryAfter } : {}) });
    }
    // Never include request bodies, tokens, codes, passwords or SMTP errors in logs.
    console.error('Account request failed', { route, category: 'internal' });
    return response.status(500).json({ error: 'Could not complete this request. Please try again.' });
  }
});
