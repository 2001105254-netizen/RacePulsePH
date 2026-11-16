const admin = require('firebase-admin');
const { onRequest } = require('firebase-functions/v2/https');
const { createRouteService } = require('./route-service');

exports.routeApi = onRequest(
  {
    region: 'asia-southeast1',
    maxInstances: 20,
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
    res.set('Cache-Control', 'no-store');
    try {
      if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });
      if (!req.is('application/json') || (req.rawBody?.length || 0) > 4 * 1024 * 1024 || !req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
        return res.status(400).json({ error: 'Invalid request payload.' });
      }
      const bearer = req.get('Authorization')?.match(/^Bearer (.+)$/)?.[1];
      if (!bearer) return res.status(401).json({ error: 'Sign in to continue.' });
      let identity;
      try {
        identity = await admin.auth().verifyIdToken(bearer, true);
      } catch {
        return res.status(401).json({ error: 'Your session has expired.' });
      }
      const storage = typeof admin.storage === 'function' ? admin.storage() : null;
      return res.json(await createRouteService(admin.firestore(), storage).execute(identity.uid, req.path, req.body));
    } catch (error) {
      const status = error && typeof error.status === 'number' && error.status >= 400 && error.status < 600 ? error.status : 400;
      const safeMessage = status < 500 && error?.message ? error.message : 'Route command failed.';
      return res.status(status).json({ error: safeMessage });
    }
  },
);
