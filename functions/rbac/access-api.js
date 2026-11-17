const admin = require('firebase-admin');
const { onRequest } = require('firebase-functions/v2/https');
const { createAccessService } = require('./access-service');
const {
  applyApiSecurityHeaders,
  enforceRateLimit,
  extractClientIp,
  verifyAppCheckRequest,
} = require('./request-guard');

exports.accessApi = onRequest({
  region: 'asia-southeast1',
  maxInstances: 20,
  concurrency: 80,
  timeoutSeconds: 30,
  cors: ['http://localhost:3000', 'http://localhost:5173', 'https://racepulseph.web.app', 'https://racepulseph.firebaseapp.com', 'https://racepulseph.com', 'https://www.racepulseph.com', 'capacitor://localhost'],
}, async (req, res) => {
  applyApiSecurityHeaders(res);
  res.set('Access-Control-Expose-Headers', 'Retry-After');
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });
    if (!req.is('application/json') || (req.rawBody?.length || 0) > 65536 || !req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      return res.status(400).json({ error: 'Invalid request.' });
    }
    const db = admin.firestore();
    const clientIp = extractClientIp(req);
    await enforceRateLimit({
      db,
      namespace: 'access_ip',
      identifier: clientIp,
      limit: 120,
      windowMs: 60 * 1000,
      message: 'Too many access checks from this network. Please wait a moment.',
      memoryOnly: true,
    });
    // Server-to-server LAN hub calls /session without a browser App Check token,
    // so /session checks any supplied token without requiring one from Node hubs.
    await verifyAppCheckRequest(req, {
      admin,
      mode: req.path === '/session' ? 'monitor' : undefined,
    });

    const bearer = req.get('Authorization')?.match(/^Bearer (.+)$/)?.[1];
    if (!bearer) return res.status(401).json({ error: 'Sign in to continue.' });
    let identity;
    try { identity = await admin.auth().verifyIdToken(bearer, true); } catch { return res.status(401).json({ error: 'Your session has expired.' }); }

    const isMutation = ['/save', '/restore', '/remove'].includes(req.path);
    await enforceRateLimit({
      db,
      namespace: isMutation ? 'access_mut_u' : 'access_uid',
      identifier: identity.uid,
      limit: isMutation ? 20 : 60,
      windowMs: 60 * 1000,
      message: 'Too many access requests. Please wait a moment.',
      memoryOnly: !isMutation,
    });

    return res.json(await createAccessService(db).execute(identity.uid, req.path, req.body));
  } catch (error) {
    const status = error && typeof error.status === 'number' && error.status >= 400 && error.status < 600 ? error.status : 400;
    const retryAfter = Number(error?.retryAfter) || 0;
    if (retryAfter > 0) res.set('Retry-After', String(retryAfter));
    const safeMessage = status < 500 && error?.message ? error.message : 'Access command failed.';
    return res.status(status).json({
      error: safeMessage,
      ...(retryAfter > 0 ? { retryAfter } : {}),
    });
  }
});
