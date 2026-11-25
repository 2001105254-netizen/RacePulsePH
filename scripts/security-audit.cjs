#!/usr/bin/env node
'use strict';

/**
 * Deterministic security, secret/password scanning, client boundary, backend/mobile
 * hardening, build output, and dependency audit gate for RacePulsePH local hooks and CI.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = process.cwd();

const PUBLIC_DIST_FIREBASE_KEY = 'AIza' + 'SyBDJINSNOpvVOtichvPKWIKixWvxa5pI9s';
const ALLOWED_FIREBASE_WEB_KEYS = new Map([
  [PUBLIC_DIST_FIREBASE_KEY, new Set(['src/firebase.ts', 'scripts/smoke-access.cjs', '.gitleaks.toml'])],
]);

const FORBIDDEN_TRACKED_FILE_PATTERNS = [
  { id: 'signing-dir', re: /^signing\//i, reason: 'Signing directory must stay local and untracked.' },
  { id: 'keystore-or-key-file', re: /\.(?:jks|keystore|p12|pfx|pem|key|crt|p8|mobileprovision)$/i, reason: 'Cryptographic key/certificate files must never be committed.' },
  { id: 'firebase-mobile-config', re: /(?:^|\/)(?:google-services\.json|GoogleService-Info\.plist)$/i, reason: 'Firebase native app config must stay outside Git.' },
  { id: 'secret-file', re: /(?:^|\/)\.secret/i, reason: 'Local secret files (.secret*) must never be committed.' },
  { id: 'env-file', re: /(?:^|\/)\.env(?!\.example$)(?:\.|$)/i, reason: 'Environment files (.env*) must stay outside Git (only .env.example is allowed).' },
  { id: 'local-race-data', re: /(?:^|\/)local_(?:orders|chip_reads|rfid_events)\.json$/i, reason: 'Runtime race-day JSON stores must stay local.' },
  { id: 'service-account-json', re: /(?:service[-_]?account|firebase-adminsdk).*\.json$/i, reason: 'Service account credential JSON files must never be committed.' },
  { id: 'keystore-txt', re: /(?:^|\/)keystore\.txt$/i, reason: 'Keystore credential manifests must never be committed.' },
];

const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif', '.ico',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.pdf', '.jar', '.xlsx', '.xls', '.zip', '.apk', '.aab',
  '.dll', '.exe', '.pdb', '.so', '.bin',
]);

const PEM_HEADER_RE = new RegExp('-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?' + 'PRIVATE KEY-----');
const SERVICE_ACCOUNT_RE = /"type"\s*:\s*"service_account"[\s\S]{0,600}"private_key"\s*:/;
const PAYMONGO_KEY_RE = new RegExp('\\bsk_' + '(?:live|test)_[A-Za-z0-9]{12,}\\b', 'g');
const PAYMONGO_WEBHOOK_RE = new RegExp('\\bwhsec_' + '[A-Za-z0-9]{12,}\\b', 'g');
const GITHUB_TOKEN_RE = new RegExp('\\b(?:gh[pousr]_' + '[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{22,})\\b', 'g');
const AWS_KEY_RE = new RegExp('\\b(?:AKIA|ASIA)' + '[0-9A-Z]{16}\\b', 'g');
const SLACK_TOKEN_RE = new RegExp('\\bxox[baprs]-' + '[0-9A-Za-z-]{10,}\\b', 'g');
const SLACK_WEBHOOK_RE = new RegExp('https://hooks\\.slack\\.com/services/' + 'T[A-Z0-9]+/B[A-Z0-9]+/[A-Za-z0-9]+', 'g');
const SENDGRID_KEY_RE = new RegExp('\\bSG\\.' + '[A-Za-z0-9_-]{16,}\\.[A-Za-z0-9_-]{20,}\\b', 'g');
const AI_KEY_RE = new RegExp('\\bsk-(?:proj|ant)-' + '[A-Za-z0-9_-]{20,}\\b', 'g');
const GOOGLE_OAUTH_SECRET_RE = new RegExp('\\bGOCSPX-' + '[A-Za-z0-9_-]{20,}\\b', 'g');
const GOOGLE_API_KEY_RE = new RegExp('\\bAIza' + '[0-9A-Za-z_-]{35}\\b', 'g');
const URI_CREDENTIALS_RE = /\b(?:mongodb(?:\+srv)?|postgres(?:ql)?|mysql|redis|amqps?|smtp):\/\/([^:\s'"`<>]+):([^@\s'"`<>]{4,})@([^\s'"`<>]+)/gi;

const SERVER_SECRET_ENV_NAMES = [
  'PAYMONGO_SECRET_KEY',
  'PAYMONGO_WEBHOOK_SECRET',
  'SMTP_APP_PASSWORD',
  'AUTH_CODE_SECRET',
  'RACEPULSE_BRIDGE_KEY',
  'KEYSTORE_PASSWORD',
  'KEYSTORE_ALIAS_PASSWORD',
  'RELEASE_STORE_PASSWORD',
  'RELEASE_KEY_PASSWORD',
  'ANDROID_KEYSTORE_PASSWORD',
  'ANDROID_KEY_PASSWORD',
  'GEMINI_API_KEY',
];

const SERVER_SECRET_LITERAL_RE = new RegExp(
  `\\b(${SERVER_SECRET_ENV_NAMES.join('|')})\\b\\s*[:=]\\s*['"]([^'"$\\n]{6,})['"]`,
  'g'
);

const ENV_KEY_VALUE_RE = new RegExp(
  `^\\s*(?:export\\s+)?(${SERVER_SECRET_ENV_NAMES.join('|')}|[A-Z0-9_]*(?:SECRET|PASSWORD|PRIVATE_KEY|TOKEN|API_KEY))\\s*=\\s*(.+?)\\s*$`,
  'gm'
);

const HARDCODED_PASSWORD_PROP_RE =
  /\b(?:password|passwd|passphrase|secret|client_?secret|api_?secret|webhook_?secret|bridge_?key|private_?key|keystore_?password|store_?password|key_?password|smtp_?(?:app_)?password|auth_?(?:code_)?secret|auth_?token|access_?token|refresh_?token|api_?key)\b\s*(?::|=|\s)\s*['"]([^\s'"$]{6,})['"]/gi;

const SAFE_AUTH_ENUM_VALUES = new Set([
  'password',
  'new-password',
  'current-password',
  'one-time-code',
  'secret',
  'secrets',
  'token',
  'bearer',
  'disabled',
  'required',
  'optional',
]);

const PLACEHOLDER_VALUE_RE = /^(?:MY_[A-Z0-9_]+|test[-_]|dummy|fake|mock|example|placeholder|changeme|your[_-]|<[^>]+>|\$\{[^}]+\}|\*{4,})/i;

const APPROVED_HIGH_ROOT_PACKAGES = new Set([
  // @grpc/grpc-js is transitive under firebase client SDK (not used in browser runtime).
  '@grpc/grpc-js',
  '@firebase/firestore',
  '@firebase/firestore-compat',
  'firebase',
]);

function redact(value) {
  const s = String(value || '');
  if (s.length <= 8) return '***';
  return `${s.slice(0, 4)}...${s.slice(-2)}`;
}

function lineNumberAt(text, index) {
  return text.slice(0, Math.max(0, index)).split('\n').length;
}

function normalizePath(relPath) {
  return relPath.replace(/\\/g, '/').replace(/^\.\//, '');
}

function isBinaryContent(buffer) {
  return buffer.includes(0);
}

function isSyntheticTestFile(relPath) {
  const p = normalizePath(relPath);
  return p.startsWith('tests/') || p.startsWith('docs/') || p.startsWith('.agents/') || p.startsWith('skills/');
}

function scanFilePath(relPath) {
  const norm = normalizePath(relPath);
  const findings = [];
  for (const rule of FORBIDDEN_TRACKED_FILE_PATTERNS) {
    if (rule.re.test(norm)) {
      findings.push({ rule: rule.id, file: norm, line: 1, detail: rule.reason });
    }
  }
  return findings;
}

function collectMatches(relPath, content, re, ruleId, detailBuilder, filterFn) {
  const findings = [];
  re.lastIndex = 0;
  let match;
  while ((match = re.exec(content)) !== null) {
    if (filterFn && !filterFn(match)) continue;
    findings.push({
      rule: ruleId,
      file: normalizePath(relPath),
      line: lineNumberAt(content, match.index),
      detail: detailBuilder(match),
    });
  }
  return findings;
}

function isAllowedGoogleApiKey(key, relPath) {
  const norm = normalizePath(relPath);
  if (norm.startsWith('dist/assets/') && norm.endsWith('.js')) {
    return key === PUBLIC_DIST_FIREBASE_KEY || key === process.env.VITE_GOOGLE_MAPS_API_KEY;
  }
  const allowedFiles = ALLOWED_FIREBASE_WEB_KEYS.get(key);
  return Boolean(allowedFiles && allowedFiles.has(norm));
}

function extractBalancedCallArgs(text, openParenIndex) {
  let depth = 0;
  for (let i = openParenIndex; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) {
        return text.slice(openParenIndex + 1, i);
      }
    }
  }
  return '';
}

function scanContentForSecrets(relPath, content) {
  const norm = normalizePath(relPath);
  const ext = path.extname(norm).toLowerCase();
  if (BINARY_EXTENSIONS.has(ext)) return [];

  const findings = [];

  if (PEM_HEADER_RE.test(content)) {
    const idx = content.search(PEM_HEADER_RE);
    findings.push({
      rule: 'private-key-pem',
      file: norm,
      line: lineNumberAt(content, idx),
      detail: 'Private key PEM header detected.',
    });
  }

  if (SERVICE_ACCOUNT_RE.test(content)) {
    const idx = content.search(SERVICE_ACCOUNT_RE);
    findings.push({
      rule: 'service-account-json',
      file: norm,
      line: lineNumberAt(content, idx),
      detail: 'GCP/Firebase service account credential JSON detected.',
    });
  }

  findings.push(...collectMatches(norm, content, PAYMONGO_KEY_RE, 'paymongo-secret-key', (m) => `Exposed PayMongo key (${redact(m[0])}).`));
  findings.push(...collectMatches(norm, content, PAYMONGO_WEBHOOK_RE, 'paymongo-webhook-secret', (m) => `Exposed PayMongo webhook secret (${redact(m[0])}).`));
  findings.push(...collectMatches(norm, content, GITHUB_TOKEN_RE, 'github-token', (m) => `Exposed GitHub token (${redact(m[0])}).`));
  findings.push(...collectMatches(norm, content, AWS_KEY_RE, 'aws-access-key', (m) => `Exposed AWS key ID (${redact(m[0])}).`));
  findings.push(...collectMatches(norm, content, SLACK_TOKEN_RE, 'slack-token', (m) => `Exposed Slack token (${redact(m[0])}).`));
  findings.push(...collectMatches(norm, content, SLACK_WEBHOOK_RE, 'slack-webhook', () => 'Exposed Slack incoming webhook URL.'));
  findings.push(...collectMatches(norm, content, SENDGRID_KEY_RE, 'sendgrid-key', (m) => `Exposed SendGrid API key (${redact(m[0])}).`));
  findings.push(...collectMatches(norm, content, AI_KEY_RE, 'ai-provider-secret', (m) => `Exposed AI API key (${redact(m[0])}).`));
  findings.push(...collectMatches(norm, content, GOOGLE_OAUTH_SECRET_RE, 'google-oauth-secret', (m) => `Exposed Google OAuth client secret (${redact(m[0])}).`));

  findings.push(
    ...collectMatches(
      norm,
      content,
      GOOGLE_API_KEY_RE,
      'unapproved-google-api-key',
      (m) => `Unexpected Google API key (${redact(m[0])}) outside allowlisted public Firebase config.`,
      (m) => !isAllowedGoogleApiKey(m[0], norm)
    )
  );

  findings.push(
    ...collectMatches(
      norm,
      content,
      URI_CREDENTIALS_RE,
      'embedded-uri-credentials',
      (m) => `Connection URI embeds credentials for user '${m[1]}'.`,
      (m) => !PLACEHOLDER_VALUE_RE.test(m[2]) && !/^(?:pass(?:word)?|secret|token)$/i.test(m[2])
    )
  );

  findings.push(
    ...collectMatches(
      norm,
      content,
      SERVER_SECRET_LITERAL_RE,
      'hardcoded-server-secret',
      (m) => `Hardcoded secret literal assigned to ${m[1]} (${redact(m[2])}).`,
      (m) => !PLACEHOLDER_VALUE_RE.test(m[2])
    )
  );

  if (norm === '.env.example' || /(?:^|\/)\.env/i.test(norm)) {
    findings.push(
      ...collectMatches(
        norm,
        content,
        ENV_KEY_VALUE_RE,
        'env-literal-secret',
        (m) => `Environment variable ${m[1]} must not hold a concrete secret.`,
        (m) => {
          const val = m[2].replace(/^['"]|['"]$/g, '').trim();
          return Boolean(val) && !PLACEHOLDER_VALUE_RE.test(val) && !val.startsWith('${');
        }
      )
    );
  }

  if (!isSyntheticTestFile(norm)) {
    findings.push(
      ...collectMatches(
        norm,
        content,
        HARDCODED_PASSWORD_PROP_RE,
        'hardcoded-password-literal',
        (m) => `Hardcoded credential/password literal (${redact(m[1])}).`,
        (m) => {
          const val = m[1];
          if (PLACEHOLDER_VALUE_RE.test(val)) return false;
          if (SAFE_AUTH_ENUM_VALUES.has(val.toLowerCase())) return false;
          if (isAllowedGoogleApiKey(val, norm)) return false;
          if (/^[a-z0-9-]+\.[a-z0-9.-]+$/i.test(val) && !val.includes(':')) return false;
          return true;
        }
      )
    );
  }

  return findings;
}

function scanClientBoundary(relPath, content) {
  const norm = normalizePath(relPath);
  const findings = [];
  const isClientFile = norm.startsWith('src/') || norm.startsWith('public/') || norm === 'index.html';
  const isServerOrScript = norm.startsWith('functions/') || norm === 'server.ts' || norm.startsWith('scripts/');

  if (isClientFile) {
    const viteSecretRe = /\bVITE_[A-Z0-9_]*(?:SECRET|PASSWORD|PRIVATE_KEY|WEBHOOK|KEYSTORE|BRIDGE_KEY|SMTP|SERVICE_ACCOUNT|PAYMONGO_SECRET)[A-Z0-9_]*\b/g;
    findings.push(...collectMatches(norm, content, viteSecretRe, 'client-vite-secret-var', (m) => `Client code must never reference secret env var ${m[0]}.`));

    const serverOnlyRe = /\b(?:PAYMONGO_SECRET_KEY|PAYMONGO_WEBHOOK_SECRET|SMTP_APP_PASSWORD|AUTH_CODE_SECRET|RACEPULSE_BRIDGE_KEY|firebase-admin)\b/g;
    findings.push(...collectMatches(norm, content, serverOnlyRe, 'client-server-only-symbol', (m) => `Client file references server-only secret or SDK (${m[0]}).`));

    const sinkRules = [
      ['dangerous-react-html', /\bdangerouslySetInnerHTML\b/g, 'dangerouslySetInnerHTML is forbidden; render safe JSX or sanitized text.'],
      ['dynamic-eval', /\beval\s*\(/g, 'eval() is forbidden.'],
      ['dynamic-function', /\bnew\s+Function\s*\(/g, 'new Function() is forbidden.'],
      ['document-write', /\bdocument\.write\s*\(/g, 'document.write() is forbidden.'],
      ['raw-inner-html', /\.(?:innerHTML|outerHTML)\s*=/g, 'Direct innerHTML/outerHTML assignment is forbidden.'],
      ['insert-adjacent-html', /\.insertAdjacentHTML\s*\(/g, 'insertAdjacentHTML() is forbidden.'],
    ];
    for (const [rule, re, detail] of sinkRules) {
      findings.push(...collectMatches(norm, content, re, rule, () => detail));
    }

    if (norm.endsWith('.svg') && /<script\b|\son[a-z]+\s*=/i.test(content)) {
      findings.push({ rule: 'unsafe-svg-script', file: norm, line: 1, detail: 'SVG assets must not contain <script> or inline event handlers.' });
    }
  }

  if (isServerOrScript) {
    findings.push(
      ...collectMatches(norm, content, /rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*['"]?0/g, 'tls-verification-disabled', () => 'Disabling TLS certificate verification is forbidden.')
    );
    if (norm !== 'scripts/security-audit.cjs') {
      findings.push(...collectMatches(norm, content, /\beval\s*\(|\bnew\s+Function\s*\(/g, 'server-dynamic-code', () => 'Dynamic eval/new Function is forbidden in server/script code.'));
    }
  }

  if (norm.startsWith('functions/')) {
    const verifyTokenRe = /\bverifyIdToken\s*\(/g;
    let match;
    while ((match = verifyTokenRe.exec(content)) !== null) {
      const openParenIndex = content.indexOf('(', match.index);
      const argsText = extractBalancedCallArgs(content, openParenIndex);
      if (!/,\s*true\s*$/.test(argsText)) {
        findings.push({
          rule: 'unrevoked-id-token-check',
          file: norm,
          line: lineNumberAt(content, match.index),
          detail: 'admin.auth().verifyIdToken() must pass checkRevoked=true as second argument.',
        });
      }
    }
    findings.push(
      ...collectMatches(norm, content, /Access-Control-Allow-Origin['"]\s*,\s*['"]\*['"]/g, 'wildcard-functions-cors', () => 'Cloud Functions must enforce an explicit origin allowlist, never "*".')
    );
  }

  return findings;
}

function scanWorkflowSecurity(relPath, content) {
  const norm = normalizePath(relPath);
  if (!norm.startsWith('.github/workflows/') || !/\.ya?ml$/i.test(norm)) return [];
  const findings = [];

  if (!/^permissions:\s*(?:\r?\n|\{)/m.test(content)) {
    findings.push({ rule: 'workflow-missing-permissions', file: norm, line: 1, detail: 'Workflow must declare top-level least-privilege permissions.' });
  }
  if (/write-all/i.test(content)) {
    findings.push({ rule: 'workflow-write-all', file: norm, line: 1, detail: 'Workflow must never request write-all permissions.' });
  }
  if (/pull_request_target\b/.test(content)) {
    findings.push({ rule: 'workflow-pull-request-target', file: norm, line: 1, detail: 'pull_request_target is forbidden to avoid untrusted PR secret exposure.' });
  }

  const lines = content.split(/\r?\n/);
  let inRunBlock = false;
  let runIndent = -1;
  let hasCheckout = false;
  let checkoutNeedsPersistFalse = false;
  let checkoutLine = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const indent = line.search(/\S|$/);

    if (/^\s*(?:-\s*)?uses:\s*actions\/checkout@/.test(line)) {
      if (checkoutNeedsPersistFalse) {
        findings.push({
          rule: 'checkout-persist-credentials',
          file: norm,
          line: checkoutLine,
          detail: 'actions/checkout must explicitly set persist-credentials: false.',
        });
      }
      hasCheckout = true;
      checkoutNeedsPersistFalse = true;
      checkoutLine = i + 1;
    } else if (checkoutNeedsPersistFalse) {
      if (/^\s*persist-credentials:\s*false\b/.test(line)) {
        checkoutNeedsPersistFalse = false;
      } else if (/^\s*-\s/.test(line) && indent <= 8) {
        findings.push({
          rule: 'checkout-persist-credentials',
          file: norm,
          line: checkoutLine,
          detail: 'actions/checkout must explicitly set persist-credentials: false.',
        });
        checkoutNeedsPersistFalse = false;
      }
    }

    if (/^\s*(?:-\s*)?run:\s*/.test(line)) {
      const inlineCmd = line.replace(/^\s*(?:-\s*)?run:\s*/, '');
      if (/\$\{\{/.test(inlineCmd)) {
        findings.push({
          rule: 'workflow-expression-injection',
          file: norm,
          line: i + 1,
          detail: 'Pass GitHub expressions through env: instead of interpolating ${{ ... }} in run:.',
        });
      }
      if (/^[|>]/.test(inlineCmd.trim())) {
        inRunBlock = true;
        runIndent = indent;
      } else {
        inRunBlock = false;
      }
      continue;
    }

    if (inRunBlock) {
      if (line.trim() && indent <= runIndent) {
        inRunBlock = false;
      } else if (/\$\{\{/.test(line)) {
        findings.push({
          rule: 'workflow-expression-injection',
          file: norm,
          line: i + 1,
          detail: 'Pass GitHub expressions through env: instead of interpolating ${{ ... }} in run:.',
        });
      }
    }
  }

  if (hasCheckout && checkoutNeedsPersistFalse) {
    findings.push({
      rule: 'checkout-persist-credentials',
      file: norm,
      line: checkoutLine,
      detail: 'actions/checkout must explicitly set persist-credentials: false.',
    });
  }

  return findings;
}

function scanZeroTrustPolicies(rootDir) {
  const findings = [];

  const sharedRbacFiles = [
    'access-api.js',
    'access-service.js',
    'access-policy.js',
    'request-guard.js',
    'telemetry-engine.js',
    'telemetry-service.js',
  ];
  for (const name of sharedRbacFiles) {
    const srcPath = path.join(rootDir, 'functions', name);
    const rbacPath = path.join(rootDir, 'functions/rbac', name);
    if (fs.existsSync(srcPath) && fs.existsSync(rbacPath)) {
      if (fs.readFileSync(srcPath, 'utf8') !== fs.readFileSync(rbacPath, 'utf8')) {
        findings.push({
          rule: 'rbac-sync-drift',
          file: `functions/rbac/${name}`,
          line: 1,
          detail: `functions/rbac/${name} is out of sync with functions/${name}; run node scripts/build-access-deploy.cjs.`,
        });
      }
    }
  }

  const firestoreRulesPath = path.join(rootDir, 'firestore.rules');
  if (fs.existsSync(firestoreRulesPath)) {
    const rules = fs.readFileSync(firestoreRulesPath, 'utf8');
    if (/\ballow\s+(?:read\s*,\s*)?write\s*:\s*if\s+true\b|\ballow\s+(?:read\s*,\s*)?write\s*:\s*if\s+request\.auth\s*!=\s*null\s*;/i.test(rules)) {
      findings.push({
        rule: 'firestore-wildcard-allow',
        file: 'firestore.rules',
        line: 1,
        detail: 'firestore.rules must never allow unauthenticated or blanket authenticated writes.',
      });
    }
  }

  const storageRulesPath = path.join(rootDir, 'storage.rules');
  if (fs.existsSync(storageRulesPath)) {
    const sRules = fs.readFileSync(storageRulesPath, 'utf8');
    if (/\ballow\s+(?:read\s*,\s*)?(?:write|create|update|delete)(?:\s*,\s*(?:write|create|update|delete))*\s*:\s*if\s+true\b/i.test(sRules)) {
      findings.push({
        rule: 'storage-wildcard-write',
        file: 'storage.rules',
        line: 1,
        detail: 'storage.rules must never allow unauthenticated writes.',
      });
    }
  }

  const lanPolicyPath = path.join(rootDir, 'functions/lan-policy.js');
  if (fs.existsSync(lanPolicyPath)) {
    const lanPolicyText = fs.readFileSync(lanPolicyPath, 'utf8');
    if (/if\s*\(\s*method\s*===\s*['"]GET['"]\s*\)\s*return\s+true\s*;/.test(lanPolicyText)) {
      findings.push({
        rule: 'lan-default-deny-get',
        file: 'functions/lan-policy.js',
        line: 1,
        detail: 'LAN authorization must enforce explicit per-route permissions on GET routes (default-deny).',
      });
    }
  }

  if (fs.existsSync(path.join(rootDir, 'functions/index.js'))) {
    const httpEndpoints = [
      'functions/access-api.js',
      'functions/auth-api.js',
      'functions/community-api.js',
      'functions/route-api.js',
      'functions/race-bib-claim-api.js',
      'functions/payments-service.js',
    ];
    for (const rel of httpEndpoints) {
      const full = path.join(rootDir, rel);
      if (fs.existsSync(full) && !fs.readFileSync(full, 'utf8').includes('applyApiSecurityHeaders')) {
        findings.push({
          rule: 'functions-security-headers',
          file: rel,
          line: 1,
          detail: `${rel} must apply Zero Trust HTTP security headers via applyApiSecurityHeaders().`,
        });
      }
    }
  }

  const serverTsPath = path.join(rootDir, 'server.ts');
  if (fs.existsSync(serverTsPath)) {
    const serverText = fs.readFileSync(serverTsPath, 'utf8');
    const requiredTokens = ['Permissions-Policy', 'X-Frame-Options', 'X-Content-Type-Options', 'Referrer-Policy', 'validateTrustedEndpointUrl'];
    for (const tok of requiredTokens) {
      if (!serverText.includes(tok)) {
        findings.push({
          rule: 'server-zero-trust-hardening',
          file: 'server.ts',
          line: 1,
          detail: `server.ts is missing required Zero Trust hardening control '${tok}'.`,
        });
      }
    }
  }

  return findings;
}

function scanConfigHardening(rootDir) {
  const findings = [];
  findings.push(...scanZeroTrustPolicies(rootDir));

  const gitignorePath = path.join(rootDir, '.gitignore');
  if (!fs.existsSync(gitignorePath)) {
    findings.push({ rule: 'gitignore-missing', file: '.gitignore', line: 1, detail: '.gitignore is missing.' });
  } else {
    const gitignore = fs.readFileSync(gitignorePath, 'utf8');
    const requiredIgnores = ['signing/', '*.jks', '*.keystore', '.env*', '.secret*', 'android/app/google-services.json', 'local_orders.json', 'local_chip_reads.json', 'local_rfid_events.json', 'release/'];
    for (const pattern of requiredIgnores) {
      if (!gitignore.includes(pattern)) {
        findings.push({ rule: 'gitignore-missing-pattern', file: '.gitignore', line: 1, detail: `.gitignore must ignore '${pattern}'.` });
      }
    }
  }

  const firebaseJsonPath = path.join(rootDir, 'firebase.json');
  if (fs.existsSync(firebaseJsonPath)) {
    const fb = JSON.parse(fs.readFileSync(firebaseJsonPath, 'utf8'));
    for (const fn of fb.functions || []) {
      const ignore = new Set(fn.ignore || []);
      if (!ignore.has('.secret*') || !ignore.has('.env*')) {
        findings.push({ rule: 'firebase-functions-ignore', file: 'firebase.json', line: 1, detail: `Functions codebase '${fn.codebase || fn.source}' must ignore .secret* and .env*.` });
      }
    }
    const hostingIgnore = new Set(fb.hosting?.ignore || []);
    if (!hostingIgnore.has('server.cjs') || !hostingIgnore.has('server.cjs.map')) {
      findings.push({ rule: 'firebase-hosting-ignore', file: 'firebase.json', line: 1, detail: 'firebase.json hosting.ignore must exclude server.cjs and server.cjs.map.' });
    }
    const globalHeaderEntry = (fb.hosting?.headers || []).find((h) => h.source === '**');
    const headerMap = Object.fromEntries((globalHeaderEntry?.headers || []).map((h) => [h.key.toLowerCase(), h.value]));
    const requiredHeaders = [
      'strict-transport-security',
      'x-content-type-options',
      'x-frame-options',
      'referrer-policy',
      'x-permitted-cross-domain-policies',
      'permissions-policy',
      'content-security-policy',
    ];
    for (const key of requiredHeaders) {
      if (!headerMap[key]) {
        findings.push({ rule: 'missing-hosting-security-header', file: 'firebase.json', line: 1, detail: `Missing hosting security header '${key}'.` });
      }
    }
    const csp = headerMap['content-security-policy'] || '';
    if (csp) {
      if (!csp.includes("object-src 'none'") || !csp.includes("frame-ancestors 'none'") || !csp.includes("base-uri 'self'")) {
        findings.push({ rule: 'weak-csp-directives', file: 'firebase.json', line: 1, detail: "CSP must enforce object-src 'none', frame-ancestors 'none', and base-uri 'self'." });
      }
      if (csp.includes("'unsafe-eval'")) {
        findings.push({ rule: 'csp-unsafe-eval', file: 'firebase.json', line: 1, detail: "CSP must not allow 'unsafe-eval'." });
      }
      const scriptSrc = /script-src[^;]*/i.exec(csp)?.[0] || '';
      if (scriptSrc.includes("'unsafe-inline'")) {
        findings.push({ rule: 'csp-script-unsafe-inline', file: 'firebase.json', line: 1, detail: "CSP script-src must not allow 'unsafe-inline'." });
      }
    }
  }

  const manifestPath = path.join(rootDir, 'android/app/src/main/AndroidManifest.xml');
  if (fs.existsSync(manifestPath)) {
    const manifest = fs.readFileSync(manifestPath, 'utf8');
    if (!manifest.includes('android:allowBackup="false"')) {
      findings.push({ rule: 'android-allow-backup', file: 'android/app/src/main/AndroidManifest.xml', line: 1, detail: 'AndroidManifest.xml must set android:allowBackup="false".' });
    }
    if (!manifest.includes('android:networkSecurityConfig="@xml/network_security_config"')) {
      findings.push({ rule: 'android-network-config', file: 'android/app/src/main/AndroidManifest.xml', line: 1, detail: 'AndroidManifest.xml must reference @xml/network_security_config.' });
    }
    if (/android:(?:usesCleartextTraffic|debuggable)\s*=\s*"true"/.test(manifest)) {
      findings.push({ rule: 'android-manifest-insecure-flag', file: 'android/app/src/main/AndroidManifest.xml', line: 1, detail: 'AndroidManifest.xml must not enable usesCleartextTraffic or debuggable.' });
    }
  }

  const netSecPath = path.join(rootDir, 'android/app/src/main/res/xml/network_security_config.xml');
  if (!fs.existsSync(netSecPath) || !fs.readFileSync(netSecPath, 'utf8').includes('<base-config cleartextTrafficPermitted="false"')) {
    findings.push({ rule: 'android-cleartext-base', file: 'android/app/src/main/res/xml/network_security_config.xml', line: 1, detail: 'Android network_security_config.xml must deny cleartext traffic by default.' });
  }

  const buildGradlePath = path.join(rootDir, 'android/app/build.gradle');
  if (fs.existsSync(buildGradlePath)) {
    const gradle = fs.readFileSync(buildGradlePath, 'utf8');
    if (!/minifyEnabled\s+true/.test(gradle) || !/shrinkResources\s+true/.test(gradle)) {
      findings.push({ rule: 'android-release-hardening', file: 'android/app/build.gradle', line: 1, detail: 'Android release buildType must enable minifyEnabled true and shrinkResources true.' });
    }
  }

  return findings;
}

function walkFiles(dirPath) {
  const out = [];
  if (!fs.existsSync(dirPath)) return out;
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const full = path.join(dirPath, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(full));
    else out.push(full);
  }
  return out;
}

function scanDistArtifacts(rootDir) {
  const distDir = path.join(rootDir, 'dist');
  const findings = [];
  if (!fs.existsSync(distDir) || !fs.existsSync(path.join(distDir, 'index.html'))) {
    findings.push({ rule: 'dist-missing', file: 'dist/index.html', line: 1, detail: 'Run npm run build before --dist security check.' });
    return findings;
  }

  for (const fullPath of walkFiles(distDir)) {
    const rel = normalizePath(path.relative(rootDir, fullPath));
    const relInDist = normalizePath(path.relative(distDir, fullPath));
    findings.push(...scanFilePath(relInDist));

    const ext = path.extname(rel).toLowerCase();
    if (!['.html', '.js', '.cjs', '.css', '.json', '.txt', '.webmanifest'].includes(ext)) continue;
    const text = fs.readFileSync(fullPath, 'utf8');
    findings.push(...scanContentForSecrets(rel, text));

    // Built client assets (excluding server.cjs) must never leak server secret variable identifiers or dev E2E auth hooks.
    if (!relInDist.startsWith('server.cjs')) {
      for (const secretName of SERVER_SECRET_ENV_NAMES) {
        if (secretName === 'GEMINI_API_KEY') continue;
        if (text.includes(secretName)) {
          findings.push({ rule: 'dist-leaked-secret-identifier', file: rel, line: 1, detail: `Client distribution asset references server secret identifier ${secretName}.` });
        }
      }
      if (text.includes('racepulse_e2e_profile')) {
        findings.push({ rule: 'dist-e2e-harness-leak', file: rel, line: 1, detail: 'Production bundle must not contain development E2E profile bypass.' });
      }
    }
  }

  const androidAssetsDir = path.join(rootDir, 'android/app/src/main/assets/public');
  if (fs.existsSync(androidAssetsDir)) {
    for (const forbidden of ['server.cjs', 'server.cjs.map']) {
      if (fs.existsSync(path.join(androidAssetsDir, forbidden))) {
        findings.push({ rule: 'android-leaked-server-asset', file: `android/app/src/main/assets/public/${forbidden}`, line: 1, detail: 'Server bundle must not remain inside Android assets.' });
      }
    }
  }

  return findings;
}

function evaluateNpmAudit(auditReport, scopeName, allowHighPackages = new Set()) {
  const findings = [];
  const vulns = auditReport?.vulnerabilities || {};
  for (const [pkg, info] of Object.entries(vulns)) {
    const sev = String(info?.severity || '').toLowerCase();
    if (sev === 'critical') {
      findings.push({
        rule: 'npm-audit-critical',
        file: scopeName === 'root' ? 'package-lock.json' : `${scopeName}/package-lock.json`,
        line: 1,
        detail: `Critical production dependency vulnerability in '${pkg}'.`,
      });
    } else if (sev === 'high' && !allowHighPackages.has(pkg)) {
      findings.push({
        rule: 'npm-audit-high',
        file: scopeName === 'root' ? 'package-lock.json' : `${scopeName}/package-lock.json`,
        line: 1,
        detail: `Unapproved high-severity production dependency vulnerability in '${pkg}'.`,
      });
    }
  }
  return findings;
}

function runNpmAudit(cwd, scopeName, allowHighPackages) {
  const isWin = process.platform === 'win32';
  const res = isWin
    ? spawnSync('npm.cmd audit --omit=dev --json', {
        cwd,
        encoding: 'utf8',
        shell: true,
        maxBuffer: 10 * 1024 * 1024,
      })
    : spawnSync('npm', ['audit', '--omit=dev', '--json'], {
        cwd,
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024,
      });
  const raw = (res.stdout || '').trim();
  if (!raw) {
    return [{
      rule: 'npm-audit-error',
      file: scopeName === 'root' ? 'package-lock.json' : `${scopeName}/package-lock.json`,
      line: 1,
      detail: `npm audit failed to produce JSON output: ${(res.stderr || '').trim() || `exit ${res.status}`}`,
    }];
  }
  try {
    const parsed = JSON.parse(raw);
    if (parsed.error) {
      return [{
        rule: 'npm-audit-registry-error',
        file: scopeName === 'root' ? 'package-lock.json' : `${scopeName}/package-lock.json`,
        line: 1,
        detail: `npm audit error: ${parsed.error.summary || parsed.error.code || 'unknown error'}`,
      }];
    }
    return evaluateNpmAudit(parsed, scopeName, allowHighPackages);
  } catch (err) {
    return [{
      rule: 'npm-audit-parse-error',
      file: scopeName === 'root' ? 'package-lock.json' : `${scopeName}/package-lock.json`,
      line: 1,
      detail: `Failed parsing npm audit JSON: ${err.message}`,
    }];
  }
}

function listTargetFiles(stagedOnly) {
  const args = stagedOnly
    ? ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z']
    : ['ls-files', '--cached', '--others', '--exclude-standard', '-z'];
  const res = spawnSync('git', args, { cwd: ROOT, encoding: 'buffer' });
  if (res.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${res.stderr?.toString('utf8')}`);
  }
  return Array.from(
    new Set(
      res.stdout
        .toString('utf8')
        .split('\0')
        .filter(Boolean)
    )
  );
}

function readGitFile(relPath, stagedOnly) {
  if (!stagedOnly) {
    const full = path.join(ROOT, relPath);
    if (!fs.existsSync(full)) return null;
    return fs.readFileSync(full);
  }
  const res = spawnSync('git', ['show', `:${normalizePath(relPath)}`], {
    cwd: ROOT,
    encoding: 'buffer',
    maxBuffer: 20 * 1024 * 1024,
  });
  return res.status === 0 ? res.stdout : null;
}

function runAudit(options = {}) {
  const stagedOnly = Boolean(options.stagedOnly);
  const checkDist = Boolean(options.checkDist);
  const auditDeps = Boolean(options.auditDeps);

  const findings = [];
  const files = listTargetFiles(stagedOnly);

  for (const relPath of files) {
    findings.push(...scanFilePath(relPath));
    const buf = readGitFile(relPath, stagedOnly);
    if (!buf || isBinaryContent(buf)) continue;
    const text = buf.toString('utf8');
    findings.push(...scanContentForSecrets(relPath, text));
    findings.push(...scanClientBoundary(relPath, text));
    findings.push(...scanWorkflowSecurity(relPath, text));
  }

  if (!stagedOnly) {
    findings.push(...scanConfigHardening(ROOT));
  }

  if (checkDist) {
    findings.push(...scanDistArtifacts(ROOT));
  }

  if (auditDeps) {
    findings.push(...runNpmAudit(ROOT, 'root', APPROVED_HIGH_ROOT_PACKAGES));
    findings.push(...runNpmAudit(path.join(ROOT, 'functions'), 'functions', new Set()));
    findings.push(...runNpmAudit(path.join(ROOT, 'functions/rbac'), 'functions/rbac', new Set()));
  }

  return { filesScanned: files.length, findings };
}

function main() {
  const args = new Set(process.argv.slice(2));
  const stagedOnly = args.has('--staged');
  const checkDist = args.has('--dist');
  const auditDeps = args.has('--audit-deps');

  const { filesScanned, findings } = runAudit({ stagedOnly, checkDist, auditDeps });
  if (findings.length > 0) {
    process.stderr.write(`FAIL: Security audit found ${findings.length} issue(s) across ${filesScanned} files:\n`);
    for (const f of findings) {
      process.stderr.write(`- [${f.rule}] ${f.file}:${f.line} — ${f.detail}\n`);
    }
    process.exitCode = 1;
    return;
  }

  process.stdout.write(
    `PASS: Security audit clean (${filesScanned} files scanned`
      + `${stagedOnly ? ', staged-only' : ', full-repo'}`
      + `${checkDist ? ', +dist' : ''}`
      + `${auditDeps ? ', +npm-audit' : ''}).\n`
  );
}

if (require.main === module) {
  main();
}

module.exports = {
  APPROVED_HIGH_ROOT_PACKAGES,
  evaluateNpmAudit,
  redact,
  runAudit,
  scanClientBoundary,
  scanConfigHardening,
  scanContentForSecrets,
  scanDistArtifacts,
  scanFilePath,
  scanWorkflowSecurity,
  scanZeroTrustPolicies,
};
