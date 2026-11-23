'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const audit = require('../scripts/security-audit.cjs');

test('scanFilePath blocks signing material, firebase native configs, secrets, and env files', () => {
  const forbidden = [
    'signing/keystore.txt',
    'signing/racepulseph-release.jks',
    'android/app/google-services.json',
    'functions/.secret.local',
    '.env',
    '.env.production',
    'local_orders.json',
    'firebase-adminsdk-prod.json',
  ];
  for (const file of forbidden) {
    assert.ok(audit.scanFilePath(file).length > 0, `Expected ${file} to be rejected`);
  }

  for (const allowed of ['.env.example', 'src/firebase.ts', 'functions/index.js', 'android/app/build.gradle']) {
    assert.equal(audit.scanFilePath(allowed).length, 0, `Expected ${allowed} to be allowed`);
  }
});

test('scanContentForSecrets catches private keys, tokens, passwords, and unapproved Google API keys', () => {
  const pem = 'const key = "-----BEGIN RSA ' + 'PRIVATE KEY-----\\nABC";';
  assert.ok(audit.scanContentForSecrets('functions/helper.js', pem).some((f) => f.rule === 'private-key-pem'));

  const svc = '{"type": "service_' + 'account", "private' + '_key_id": "1", "private_key": "abc"}';
  assert.ok(audit.scanContentForSecrets('config.json', svc).some((f) => f.rule === 'service-account-json'));

  const paymongo = 'const k = "' + 'sk_' + 'live_' + '9876543210abcdef";';
  assert.ok(audit.scanContentForSecrets('src/pay.ts', paymongo).some((f) => f.rule === 'paymongo-secret-key'));

  const webhook = 'const w = "' + 'whsec_' + '9876543210abcdef";';
  assert.ok(audit.scanContentForSecrets('functions/pay.js', webhook).some((f) => f.rule === 'paymongo-webhook-secret'));

  const gh = 'const t = "' + 'ghp_' + 'ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890";';
  assert.ok(audit.scanContentForSecrets('scripts/deploy.js', gh).some((f) => f.rule === 'github-token'));

  const aws = 'const a = "' + 'AKIA' + 'IOSFODNN7EXAMPLE";';
  assert.ok(audit.scanContentForSecrets('scripts/deploy.js', aws).some((f) => f.rule === 'aws-access-key'));

  const uri = 'const db = "postgres://admin:' + 'SuperSecret99@db.example.com:5432/prod";';
  assert.ok(audit.scanContentForSecrets('server.ts', uri).some((f) => f.rule === 'embedded-uri-credentials'));

  const hardcodedSecret = 'const x = { SMTP_' + 'APP_PASSWORD: "' + 'realAppPass12345" };';
  assert.ok(audit.scanContentForSecrets('functions/mail.js', hardcodedSecret).some((f) => f.rule === 'hardcoded-server-secret'));

  const hardcodedPassword = 'store' + 'Password "' + 'myRealStorePass9"';
  assert.ok(audit.scanContentForSecrets('android/app/build.gradle', hardcodedPassword).some((f) => f.rule === 'hardcoded-password-literal'));

  const unknownAiza = 'const apiKey = "' + 'AIza' + 'SyA12345678901234567890123456789012";';
  assert.ok(audit.scanContentForSecrets('src/firebase.ts', unknownAiza).some((f) => f.rule === 'unapproved-google-api-key'));

  // Public Firebase web API key in src/firebase.ts must remain allowed, while misplaced copy fails.
  const publicFirebaseLine = 'const firebaseConfig = { apiKey: "' + 'AIza' + 'SyBDJINSNOpvVOtichvPKWIKixWvxa5pI9s" };';
  assert.equal(audit.scanContentForSecrets('src/firebase.ts', publicFirebaseLine).length, 0);
  assert.ok(audit.scanContentForSecrets('src/other.ts', publicFirebaseLine).some((f) => f.rule === 'unapproved-google-api-key'));

  // .env.example placeholder remains allowed.
  assert.equal(audit.scanContentForSecrets('.env.example', 'GEMINI_API_KEY="MY_GEMINI_API_KEY"\nVITE_COMPANY_NAME="RacePulsePH"\n').length, 0);
});

test('scanClientBoundary enforces client isolation, XSS sink bans, TLS checks, and token revocation', () => {
  assert.ok(audit.scanClientBoundary('src/bad.ts', 'const k = import.meta.env.VITE_PAYMONGO_SECRET;').some((f) => f.rule === 'client-vite-secret-var'));
  assert.ok(audit.scanClientBoundary('src/bad.tsx', '<div dangerouslySetInnerHTML={{ __html: html }} />').some((f) => f.rule === 'dangerous-react-html'));
  assert.ok(audit.scanClientBoundary('src/bad.ts', 'eval("1+1")').some((f) => f.rule === 'dynamic-eval'));
  assert.ok(audit.scanClientBoundary('public/bad.svg', '<svg><script>alert(1)</script></svg>').some((f) => f.rule === 'unsafe-svg-script'));
  assert.ok(audit.scanClientBoundary('server.ts', 'const agent = { rejectUnauthorized: false };').some((f) => f.rule === 'tls-verification-disabled'));

  assert.ok(audit.scanClientBoundary('functions/bad.js', 'admin.auth().verifyIdToken(token);').some((f) => f.rule === 'unrevoked-id-token-check'));
  assert.ok(audit.scanClientBoundary('functions/bad.js', 'admin.auth().verifyIdToken(token, false);').some((f) => f.rule === 'unrevoked-id-token-check'));
  assert.equal(audit.scanClientBoundary('functions/good.js', 'admin.auth().verifyIdToken(header.slice(7), true);').length, 0);
  assert.ok(audit.scanClientBoundary('functions/bad.js', "res.set('Access-Control-Allow-Origin', '*');").some((f) => f.rule === 'wildcard-functions-cors'));
});

test('scanWorkflowSecurity rejects missing permissions, pull_request_target, unpinned checkout creds, and run interpolations', () => {
  const insecureYaml = [
    'name: Bad',
    'on: pull_request_target',
    'jobs:',
    '  build:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - uses: actions/checkout@v7',
    '      - run: echo "${{ github.head_ref }}"',
  ].join('\n');

  const rules = new Set(audit.scanWorkflowSecurity('.github/workflows/bad.yml', insecureYaml).map((f) => f.rule));
  assert.ok(rules.has('workflow-missing-permissions'));
  assert.ok(rules.has('workflow-pull-request-target'));
  assert.ok(rules.has('checkout-persist-credentials'));
  assert.ok(rules.has('workflow-expression-injection'));

  const secureYaml = [
    'name: Good',
    'on: push',
    'permissions:',
    '  contents: read',
    'jobs:',
    '  build:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - uses: actions/checkout@v7',
    '        with:',
    '          persist-credentials: false',
    '      - env:',
    '          REF_NAME: ${{ github.ref_name }}',
    '        run: echo "$REF_NAME"',
  ].join('\n');
  assert.equal(audit.scanWorkflowSecurity('.github/workflows/good.yml', secureYaml).length, 0);
});

test('evaluateNpmAudit blocks critical vulnerabilities and any unapproved high vulnerabilities', () => {
  const reportWithApprovedOnly = {
    vulnerabilities: {
      '@grpc/grpc-js': { severity: 'high' },
      qs: { severity: 'moderate' },
    },
  };
  assert.equal(audit.evaluateNpmAudit(reportWithApprovedOnly, 'root', audit.APPROVED_HIGH_ROOT_PACKAGES).length, 0);

  const reportWithNewHigh = {
    vulnerabilities: {
      xlsx: { severity: 'high' },
    },
  };
  assert.equal(audit.evaluateNpmAudit(reportWithNewHigh, 'root', audit.APPROVED_HIGH_ROOT_PACKAGES).length, 1);

  const reportWithCritical = {
    vulnerabilities: {
      xlsx: { severity: 'critical' },
    },
  };
  assert.equal(audit.evaluateNpmAudit(reportWithCritical, 'root', audit.APPROVED_HIGH_ROOT_PACKAGES).length, 1);
  assert.equal(audit.evaluateNpmAudit(reportWithNewHigh, 'functions', new Set()).length, 1);
});
