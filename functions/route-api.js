const admin = require('firebase-admin');
const { onRequest } = require('firebase-functions/v2/https');
const { createRouteService } = require('./route-service');
const {
  applyApiSecurityHeaders,
  enforceRateLimit,
  extractClientIp,
  getLimiterForDb,
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

exports.routeApi = onRequest(
  {
    region: 'asia-southeast1',
    maxInstances: 20,
    concurrency: 80,
    timeoutSeconds: 60,
    cors: [
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      'http://localhost:3100',
      'http://127.0.0.1:3100',
      'http://localhost:5173',
      'https://racepulseph.web.app',
      'https://racepulseph.firebaseapp.com',
      'https://racepulseph.com',
      'https://www.racepulseph.com',
      'capacitor://localhost',
    ],
  },
  async (req, res) => {
    applyApiSecurityHeaders(res);
    res.set('Access-Control-Expose-Headers', 'Retry-After');
    let releaseSlot = null;
    try {
      if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });
      if (!req.is('application/json') || (req.rawBody?.length || 0) > 4 * 1024 * 1024 || !req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
        return res.status(400).json({ error: 'Invalid request payload.' });
      }
      const db = admin.firestore();
      const clientIp = extractClientIp(req);
      await enforceRateLimit({
        db,
        namespace: 'route_ip',
        identifier: clientIp,
        limit: 60,
        windowMs: 60 * 1000,
        message: 'Too many route requests from this network. Please wait a moment.',
        memoryOnly: true,
      });
      await verifyAppCheckRequest(req, { admin });

      const bearer = req.get('Authorization')?.match(/^Bearer (.+)$/)?.[1];
      if (!bearer) return res.status(401).json({ error: 'Sign in to continue.' });
      let identity;
      try {
        identity = await admin.auth().verifyIdToken(bearer, true);
      } catch {
        return res.status(401).json({ error: 'Your session has expired.' });
      }

      const routePath = (req.path || '/').replace(/\/+$/, '') || '/';
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

      const storage = typeof admin.storage === 'function' ? admin.storage() : null;
      return res.json(await createRouteService(db, storage).execute(identity.uid, routePath, req.body));
    } catch (error) {
      const status = error && typeof error.status === 'number' && error.status >= 400 && error.status < 600 ? error.status : 400;
      const retryAfter = Number(error?.retryAfter) || 0;
      if (retryAfter > 0) res.set('Retry-After', String(retryAfter));
      const safeMessage = status < 500 && error?.message ? error.message : 'Route command failed.';
      return res.status(status).json({
        error: safeMessage,
        ...(retryAfter > 0 ? { retryAfter } : {}),
      });
    } finally {
      if (releaseSlot) releaseSlot();
    }
  },
);
