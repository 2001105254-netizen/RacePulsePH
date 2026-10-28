// Generated deployment entrypoint; canonical source lives in functions/access-*.js.
const admin = require('firebase-admin');
admin.initializeApp();
exports.accessApi = require('./access-api').accessApi;
