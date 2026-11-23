/*
 * RacePulsePH payments backend.
 *
 * PayMongo secret keys intentionally live only in Firebase Functions secrets.
 * The browser can request a Checkout URL and view its own payment status, but
 * a signed PayMongo webhook is the sole path that issues a paid registration
 * and its race bib.
 */
const admin = require('firebase-admin');
const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret, defineString } = require('firebase-functions/params');
const { createPaymentsApp } = require('./payments-service');

admin.initializeApp();
exports.accountApi = require('./auth-api').accountApi;
exports.raceBibClaimApi = require('./race-bib-claim-api').raceBibClaimApi;
exports.routeApi = require('./route-api').routeApi;
const db = admin.firestore();

const paymongoSecretKey = defineSecret('PAYMONGO_SECRET_KEY');
const paymongoWebhookSecret = defineSecret('PAYMONGO_WEBHOOK_SECRET');
const appUrl = defineString('PAYMENTS_APP_URL', { default: 'https://racepulseph.web.app' });

const paymentsHandler = createPaymentsApp({
  admin,
  db,
  getPaymongoSecretKey: () => paymongoSecretKey.value(),
  getPaymongoWebhookSecret: () => paymongoWebhookSecret.value(),
  getAppUrl: () => appUrl.value(),
});

exports.paymentsApi = onRequest(
  {
    region: 'asia-southeast1',
    maxInstances: 20,
    concurrency: 80,
    timeoutSeconds: 30,
    secrets: [paymongoSecretKey, paymongoWebhookSecret],
  },
  paymentsHandler,
);
