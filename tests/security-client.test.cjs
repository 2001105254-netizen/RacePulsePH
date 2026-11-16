const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function loadSecurityModule() {
  const source = fs.readFileSync(path.join(__dirname, '../src/lib/security.ts'), 'utf8');
  const javascript = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function('module', 'exports', javascript)(module, module.exports);
  return module.exports;
}

const security = loadSecurityModule();

test('sanitizeCsvCell neutralizes spreadsheet formula prefixes and escapes quotes', () => {
  assert.equal(security.sanitizeCsvCell('=1+1'), `"'=1+1"`);
  assert.equal(security.sanitizeCsvCell('+cmd|"/C calc"!A0'), `"'+cmd|""/C calc""!A0"`);
  assert.equal(security.sanitizeCsvCell('-2+3'), `"'-2+3"`);
  assert.equal(security.sanitizeCsvCell('@SUM(A1:A2)'), `"'@SUM(A1:A2)"`);
  assert.equal(security.sanitizeCsvCell('\t=HYPERLINK("https://evil.example")'), `"'\t=HYPERLINK(""https://evil.example"")"`);
  assert.equal(security.sanitizeCsvCell('  =CMD()'), `"'  =CMD()"`);
  assert.equal(security.sanitizeCsvCell('Juan "The Jet" Dela Cruz'), `"Juan ""The Jet"" Dela Cruz"`);
});

test('isSafeRasterImageType blocks SVG uploads and mismatched extensions', () => {
  assert.equal(security.isSafeRasterImageType('image/png', 'photo.png'), true);
  assert.equal(security.isSafeRasterImageType('image/jpeg', 'runner.JPEG'), true);
  assert.equal(security.isSafeRasterImageType('image/webp', 'card.webp'), true);
  assert.equal(security.isSafeRasterImageType('image/svg+xml', 'xss.svg'), false);
  assert.equal(security.isSafeRasterImageType('image/png', 'disguised.svg'), false);
  assert.equal(security.isSafeRasterImageType('text/html', 'index.html'), false);
});

test('sanitizePhotoReference rejects javascript, SVG data URLs, and cleartext HTTP URLs', () => {
  assert.equal(security.sanitizePhotoReference('/assets/runner.webp'), '/assets/runner.webp');
  assert.equal(security.sanitizePhotoReference('//evil.example/a.png'), '');
  assert.equal(security.sanitizePhotoReference('https://firebasestorage.googleapis.com/a.jpg'), 'https://firebasestorage.googleapis.com/a.jpg');
  assert.equal(security.sanitizePhotoReference('http://insecure.example/a.jpg'), '');
  assert.equal(security.sanitizePhotoReference('javascript:alert(1)'), '');
  assert.equal(security.sanitizePhotoReference('data:image/svg+xml;base64,PHN2Zz4='), '');
  assert.equal(security.sanitizePhotoReference('data:image/png;base64,AAAA'), 'data:image/png;base64,AAAA');
});

test('sanitizeHttpUrl restricts protocols accurately', () => {
  assert.equal(security.sanitizeHttpUrl('https://racepulseph.com/u/1'), 'https://racepulseph.com/u/1');
  assert.equal(security.sanitizeHttpUrl('http://localhost:3000'), 'http://localhost:3000/');
  assert.equal(security.sanitizeHttpUrl('http://localhost:3000', true), '');
  assert.equal(security.sanitizeHttpUrl('javascript:alert(document.cookie)'), '');
  assert.equal(security.sanitizeHttpUrl('data:text/html,<script>1</script>'), '');
});

test('stripUnsafeKeys drops prototype pollution keys while keeping valid nested fields', () => {
  const polluted = JSON.parse('{"id":"ord_1","__proto__":{"isAdmin":true},"nested":{"constructor":{"prototype":{"x":1}},"ok":"yes"},"list":[{"prototype":{"y":2},"bib":"5-001"}]}');
  const cleaned = security.stripUnsafeKeys(polluted);
  assert.equal(Object.hasOwn(cleaned, '__proto__'), false);
  assert.equal(Object.hasOwn(cleaned.nested, 'constructor'), false);
  assert.equal(cleaned.nested.ok, 'yes');
  assert.equal(Object.hasOwn(cleaned.list[0], 'prototype'), false);
  assert.equal(cleaned.list[0].bib, '5-001');
  assert.equal(({}).isAdmin, undefined);
});

test('randomShortCode uses alphabet and respects length bounds', () => {
  const code = security.randomShortCode(12, 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789');
  assert.equal(code.length, 12);
  assert.match(code, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{12}$/);
  assert.equal(security.randomShortCode(0), '');
});

test('assertSafeImportFile validates extensions and maximum byte sizes', () => {
  assert.doesNotThrow(() =>
    security.assertSafeImportFile({ name: 'roster.xlsx', size: 1024 }, 5 * 1024 * 1024, /\.(xlsx|xls|csv)$/i, 'Bad file')
  );
  assert.throws(
    () => security.assertSafeImportFile({ name: 'payload.html', size: 512 }, 5 * 1024 * 1024, /\.(xlsx|xls|csv)$/i, 'Bad file'),
    /Bad file/
  );
  assert.throws(
    () => security.assertSafeImportFile({ name: 'huge.xlsx', size: 10 * 1024 * 1024 }, 5 * 1024 * 1024, /\.(xlsx|xls|csv)$/i, 'Bad file'),
    /safety limit/
  );
});
