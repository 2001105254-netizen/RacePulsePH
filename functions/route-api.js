const admin = require('firebase-admin');
const { onRequest } = require('firebase-functions/v2/https');
const { createRouteService } = require('./route-service');
const {
  applyApiSecurityHeaders,
  enforceRateLimit,
  extractClientIp,
  getDefaultAllowedOrigins,
  getLimiterForDb,
  logSecurityEvent,
  resolveRequestId,
  stripPrototypePollution,
  verifyAppCheckRequest,
} = require('./request-guard');

const ROUTE_MUTATION_PATHS = new Set([
  '/create-preset',
  '/save-draft',
  '/create-version',
  '/bind-publish',
  '/withdraw',
  '/rollback',
  '/archive-preset',
]);

function getRouteCorsOrigins() {
  return getDefaultAllowedOrigins();
}

function createRouteApp({ admin: adminClient, db, storage = null, appCheckMode } = {}) {
  return async (req, res) => {
    applyApiSecurityHeaders(res);
    const requestId = resolveRequestId(req, res);
    res.set('Access-Control-Expose-Headers', 'Retry-After, X-Request-Id');
    let releaseSlot = null;
    const routePath = (req.path || '/').replace(/\/+$/, '') || '/';
    const clientIp = extractClientIp(req);
    try {
      if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });
      if (!req.is('application/json') || (req.rawBody?.length || 0) > 4 * 1024 * 1024 || !req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
        return res.status(400).json({ error: 'Invalid request payload.' });
      }
      const cleanBody = stripPrototypePollution(req.body);
      await enforceRateLimit({
        db,
        namespace: 'route_ip',
        identifier: clientIp,
        limit: 60,
        windowMs: 60 * 1000,
        message: 'Too many route requests from this network. Please wait a moment.',
        memoryOnly: true,
      });
      await verifyAppCheckRequest(req, { admin: adminClient, mode: appCheckMode });

      const bearer = req.get('Authorization')?.match(/^Bearer (.+)$/)?.[1];
      if (!bearer) return res.status(401).json({ error: 'Sign in to continue.' });
      let identity;
      try {
        identity = await adminClient.auth().verifyIdToken(bearer, true);
      } catch {
        logSecurityEvent({ event: 'invalid_id_token', decision: 'deny', route: routePath, requestId, status: 401, code: 'token_rejected', ipBucket: clientIp });
        return res.status(401).json({ error: 'Your session has expired.' });
      }

      if (ROUTE_MUTATION_PATHS.has(routePath)) {
        await enforceRateLimit({
          db,
          namespace: 'route_mut_u',
          identifier: identity.uid,
          limit: 30,
          windowMs: 15 * 60 * 1000,
          message: 'Route edit quota reached for now. Wait a few minutes before submitting again.',
        });
      }
      releaseSlot = getLimiterForDb(db).acquireConcurrency(
        `route_slot:${identity.uid}`,
        3,
        'Too many concurrent route operations. Wait for the active save to finish.',
      );

      const resolvedStorage = storage ?? (typeof adminClient.storage === 'function' ? adminClient.storage() : null);
      return res.json(await createRouteService(db, resolvedStorage).execute(identity.uid, routePath, cleanBody));
    } catch (error) {
      const status = error && typeof error.status === 'number' && error.status >= 400 && error.status < 600 ? error.status : 500;
      const retryAfter = Number(error?.retryAfter) || 0;
      if (retryAfter > 0) res.set('Retry-After', String(retryAfter));
      if (status === 401 || status === 403 || status === 429) {
        logSecurityEvent({ event: 'route_api_denied', decision: 'deny', route: routePath, requestId, status, code: error?.code || 'denied', ipBucket: clientIp });
      }
      if (status >= 500) {
        console.error('Route API error', { route: routePath, requestId, status, code: error?.code || 'internal' });
      }
      const safeMessage = status < 500 && error?.message ? error.message : 'Route command failed.';
      return res.status(status).json({
        error: safeMessage,
        ...(retryAfter > 0 ? { retryAfter } : {}),
      });
    } finally {
      if (releaseSlot) releaseSlot();
    }
  };
}

exports.createRouteApp = createRouteApp;
exports.routeApi = onRequest(
  {
    region: 'asia-southeast1',
    maxInstances: 20,
    concurrency: 80,
    timeoutSeconds: 60,
    cors: getRouteCorsOrigins(),
  },
  (req, res) => createRouteApp({ admin, db: admin.firestore() })(req, res),
);
