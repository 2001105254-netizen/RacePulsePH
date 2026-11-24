'use strict';

const admin = require('firebase-admin');
const { onRequest } = require('firebase-functions/v2/https');
const { createCommunityService } = require('./community-service');
const {
  applyApiSecurityHeaders,
  enforceRateLimit,
  extractClientIp,
  getDefaultAllowedOrigins,
  getLimiterForDb,
  verifyAppCheckRequest,
} = require('./request-guard');

const MAX_COMMUNITY_BODY_BYTES = Math.floor(2.5 * 1024 * 1024);

const COMMUNITY_MUTATION_PATHS = new Set([
  '/runs/complete',
  '/runs/update',
  '/runs/delete',
]);

function exceedsMaxJsonBytes(req, maxBytes = MAX_COMMUNITY_BODY_BYTES) {
  if (req.rawBody !== undefined && req.rawBody !== null) {
    if (Buffer.isBuffer(req.rawBody)) {
      if (req.rawBody.length > maxBytes) return true;
    } else if (typeof req.rawBody === 'string') {
      if (Buffer.byteLength(req.rawBody, 'utf8') > maxBytes) return true;
    }
  }
  if (req.body && typeof req.body === 'object') {
    try {
      if (Buffer.byteLength(JSON.stringify(req.body), 'utf8') > maxBytes) {
        return true;
      }
    } catch {
      return true;
    }
  }
  return false;
}

function createCommunityApp({ admin: adminClient, db, storage = null, appCheckMode } = {}) {
  return async (req, res) => {
    applyApiSecurityHeaders(res);
    res.set('Access-Control-Expose-Headers', 'Retry-After');
    let releaseSlot = null;
    const routePath = (req.path || '/').replace(/\/+$/, '') || '/';
    try {
      if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });
      if (!req.is('application/json') || !req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
        return res.status(400).json({ error: 'Invalid request payload.' });
      }
      if (exceedsMaxJsonBytes(req, MAX_COMMUNITY_BODY_BYTES)) {
        return res.status(413).json({ error: 'Request payload exceeds 2.5 MB limit.' });
      }

      const clientIp = extractClientIp(req);
      await enforceRateLimit({
        db,
        namespace: 'community_ip',
        identifier: clientIp,
        limit: 60,
        windowMs: 60 * 1000,
        message: 'Too many community requests from this network. Please wait a moment.',
        memoryOnly: true,
      });
      await verifyAppCheckRequest(req, { admin: adminClient, mode: appCheckMode });

      const bearer = req.get('Authorization')?.match(/^Bearer (.+)$/)?.[1];
      if (!bearer) return res.status(401).json({ error: 'Sign in to continue.' });
      let identity;
      try {
        identity = await adminClient.auth().verifyIdToken(bearer, true);
      } catch {
        return res.status(401).json({ error: 'Your session has expired.' });
      }

      if (COMMUNITY_MUTATION_PATHS.has(routePath)) {
        await enforceRateLimit({
          db,
          namespace: 'community_mut_u',
          identifier: identity.uid,
          limit: 30,
          windowMs: 15 * 60 * 1000,
          message: 'Run upload quota reached for now. Wait a few minutes before submitting again.',
        });
      }
      releaseSlot = getLimiterForDb(db).acquireConcurrency(
        `community_slot:${identity.uid}`,
        3,
        'Too many concurrent community operations. Wait for the active save to finish.',
      );

      const resolvedStorage =
        storage ?? (typeof adminClient.storage === 'function' ? adminClient.storage() : null);
      return res.json(
        await createCommunityService(db, resolvedStorage).execute(identity.uid, routePath, req.body),
      );
    } catch (error) {
      const status =
        error && typeof error.status === 'number' && error.status >= 400 && error.status < 600
          ? error.status
          : 500;
      const retryAfter = Number(error?.retryAfter) || 0;
      if (retryAfter > 0) res.set('Retry-After', String(retryAfter));
      if (status >= 500) {
        console.error('Community API error', {
          route: routePath,
          status,
          code: error?.code || 'internal',
        });
      }
      const safeMessage =
        status < 500 && error?.message ? error.message : 'Community command failed.';
      return res.status(status).json({
        error: safeMessage,
        ...(retryAfter > 0 ? { retryAfter } : {}),
      });
    } finally {
      if (releaseSlot) releaseSlot();
    }
  };
}

exports.createCommunityApp = createCommunityApp;
exports.communityApi = onRequest(
  {
    region: 'asia-southeast1',
    maxInstances: 20,
    concurrency: 80,
    timeoutSeconds: 60,
    cors: getDefaultAllowedOrigins(),
  },
  (req, res) => createCommunityApp({ admin, db: admin.firestore() })(req, res),
);
