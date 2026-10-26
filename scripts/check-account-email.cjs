const fs = require('node:fs');
const path = require('node:path');
const nodemailer = require('../functions/node_modules/nodemailer');
const values = Object.fromEntries(fs.readFileSync(path.join(__dirname, '../functions/.secret.local'), 'utf8').split(/\r?\n/).filter((line) => /^[A-Z_]+=/.test(line)).map((line) => { const position = line.indexOf('='); return [line.slice(0, position), line.slice(position + 1)]; }));
const transport = nodemailer.createTransport({
  host: 'smtp.gmail.com', port: 465, secure: true,
  auth: { user: 'events@racepulseph.com', pass: values.SMTP_APP_PASSWORD.replace(/\s/g, '') },
  connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 20000,
  logger: false, debug: false,
});
transport.verify().then(() => {
  console.log('Google SMTP sign-in verified for the configured RacePulse sender. No email was sent.');
  transport.close();
}).catch((error) => {
  console.error('Google SMTP verification failed.', { category: ['EAUTH', 'ETIMEDOUT', 'ECONNECTION', 'ESOCKET'].includes(error.code) ? error.code : 'connection-error' });
  transport.close();
  process.exitCode = 1;
});
