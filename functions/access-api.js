const admin = require('firebase-admin');
const { onRequest } = require('firebase-functions/v2/https');
const { createAccessService } = require('./access-service');
exports.accessApi = onRequest({ region: 'asia-southeast1', cors: ['http://localhost:3000', 'http://localhost:5173', 'https://racepulseph.web.app', 'https://racepulseph.firebaseapp.com', 'https://racepulseph.com', 'https://www.racepulseph.com', 'capacitor://localhost'] }, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });
    if (!req.is('application/json') || (req.rawBody?.length || 0) > 65536) return res.status(400).json({ error: 'Invalid request.' });
    const bearer = req.get('Authorization')?.match(/^Bearer (.+)$/)?.[1];
    if (!bearer) return res.status(401).json({ error: 'Sign in to continue.' });
    let identity;
    try { identity = await admin.auth().verifyIdToken(bearer, true); } catch { return res.status(401).json({ error: 'Your session has expired.' }); }
    return res.json(await createAccessService(admin.firestore()).execute(identity.uid, req.path, req.body));
  } catch (error) { return res.status(error.status || 400).json({ error: error.message || 'Access command failed.' }); }
});
