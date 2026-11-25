const admin = require('firebase-admin');
const { onRequest } = require('firebase-functions/v2/https');
const { createAccessService } = require('./access-service');
const {
  applyApiSecurityHeaders,
  enforceRateLimit,
  extractClientIp,
  getDefaultAllowedOrigins,
  logSecurityEvent,
  resolveRequestId,
  stripPrototypePollution,
  verifyAppCheckRequest,
} = require('./request-guard');

function getAccessCorsOrigins() {
  return getDefaultAllowedOrigins();
}

function createAccessApp({ admin: adminClient, db, appCheckMode } = {}) {
  return async (req, res) => {
    applyApiSecurityHeaders(res);
    const requestId = resolveRequestId(req, res);
    res.set('Access-Control-Expose-Headers', 'Retry-After, X-Request-Id');
    const path = (req.path || '/').replace(/\/+$/, '') || '/';
    const clientIp = extractClientIp(req);
    try {
      if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });
      if (!req.is('application/json') || (req.rawBody?.length || 0) > 65536 || !req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
        return res.status(400).json({ error: 'Invalid request.' });
      }
      const cleanBody = stripPrototypePollution(req.body);
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
        admin: adminClient,
        mode: appCheckMode ?? (path === '/session' ? 'monitor' : undefined),
      });

      const bearer = req.get('Authorization')?.match(/^Bearer (.+)$/)?.[1];
      if (!bearer) return res.status(401).json({ error: 'Sign in to continue.' });
      let identity;
      try { identity = await adminClient.auth().verifyIdToken(bearer, true); } catch {
        logSecurityEvent({ event: 'invalid_id_token', decision: 'deny', route: path, requestId, status: 401, code: 'token_rejected', ipBucket: clientIp });
        return res.status(401).json({ error: 'Your session has expired.' });
      }

      const isMutation = ['/save', '/restore', '/remove'].includes(path);
      const isHeartbeat = path === '/presence/heartbeat';
      await enforceRateLimit({
        db,
        namespace: isMutation ? 'access_mut_u' : isHeartbeat ? 'access_hb_u' : 'access_uid',
        identifier: identity.uid,
        limit: isMutation ? 20 : isHeartbeat ? 12 : path === '/telemetry' ? 30 : 60,
        windowMs: isHeartbeat ? 15 * 60 * 1000 : 60 * 1000,
        message: 'Too many access requests. Please wait a moment.',
        memoryOnly: !isMutation,
      });

      const authClient = typeof adminClient?.auth === 'function' ? adminClient.auth() : null;
      return res.json(await createAccessService(db, authClient).execute(identity.uid, path, cleanBody));
    } catch (error) {
      const status = error && typeof error.status === 'number' && error.status >= 400 && error.status < 600 ? error.status : 500;
      const retryAfter = Number(error?.retryAfter) || 0;
      if (retryAfter > 0) res.set('Retry-After', String(retryAfter));
      if (status === 401 || status === 403 || status === 429) {
        logSecurityEvent({ event: 'access_api_denied', decision: 'deny', route: path, requestId, status, code: error?.code || 'denied', ipBucket: clientIp });
      }
      if (status >= 500) {
        console.error('Access API error', { route: path, requestId, status, code: error?.code || 'internal' });
      }
      const safeMessage = status < 500 && error?.message ? error.message : 'Access command failed.';
      return res.status(status).json({
        error: safeMessage,
        ...(retryAfter > 0 ? { retryAfter } : {}),
      });
    }
  };
}

exports.createAccessApp = createAccessApp;
exports.accessApi = onRequest({
  region: 'asia-southeast1',
  maxInstances: 20,
  concurrency: 80,
  timeoutSeconds: 30,
  cors: getAccessCorsOrigins(),
}, (req, res) => createAccessApp({ admin, db: admin.firestore() })(req, res));
