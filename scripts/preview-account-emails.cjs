const fs = require('node:fs');
const path = require('node:path');
const { accountEmail } = require('../functions/account-email');
const destination = path.join(__dirname, '../output/account-emails');
fs.mkdirSync(destination, { recursive: true });
for (const [purpose, file] of [['verify', 'verification.html'], ['reset', 'password-reset.html']]) {
  const { html } = accountEmail({ purpose, name: 'Juan Dela Cruz', code: '123456', logoSource: '../../functions/assets/racepulse-email-logo.png' });
  fs.writeFileSync(path.join(destination, file), html);
}
console.log('Email previews created in output/account-emails. All codes are demonstrations.');
