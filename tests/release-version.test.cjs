'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const {
  parseSemver,
  compareSemver,
  bumpSemver,
  parseGradleVersion,
  parseIssVersion,
  checkParity,
  computeAutoTarget,
} = require('../scripts/release-version.cjs');

test('parseSemver and compareSemver handle standard X.Y.Z tuples', () => {
  assert.deepEqual(parseSemver('1.0.1'), [1, 0, 1]);
  assert.equal(parseSemver('1.0'), null);
  assert.equal(compareSemver('1.0.2', '1.0.1'), 1);
  assert.equal(compareSemver('1.1.0', '1.0.99'), 1);
  assert.equal(compareSemver('2.0.0', '1.9.9'), 1);
  assert.equal(compareSemver('1.0.1', '1.0.1'), 0);
});

test('bumpSemver increments patch, minor, and major components', () => {
  assert.equal(bumpSemver('1.0.1', 'patch'), '1.0.2');
  assert.equal(bumpSemver('1.2.9', 'minor'), '1.3.0');
  assert.equal(bumpSemver('1.2.9', 'major'), '2.0.0');
});

test('parseGradleVersion and parseIssVersion extract expected version metadata', () => {
  const gradle = parseGradleVersion('        versionCode 12\n        versionName "1.4.2"\n');
  assert.deepEqual(gradle, { versionCode: 12, versionName: '1.4.2' });
  assert.equal(parseIssVersion('#define AppVersion "1.4.2"\n'), '1.4.2');
});

test('checkParity reports zero issues when package, lockfile, gradle, and iss match', () => {
  const issues = checkParity({
    pkgName: 'racepulseph',
    pkgVersion: '1.0.1',
    lockVersion: '1.0.1',
    lockRootPackageVersion: '1.0.1',
    gradleVersionCode: 2,
    gradleVersionName: '1.0.1',
    issVersion: '1.0.1',
  });
  assert.deepEqual(issues, []);
});

test('computeAutoTarget increments patch and versionCode on ordinary commits and preserves manual bumps', () => {
  assert.deepEqual(
    computeAutoTarget({ headVer: '1.0.1', headCode: 2, workVer: '1.0.1', workCode: 2 }),
    { version: '1.0.2', versionCode: 3, alreadyBumped: false }
  );
  assert.deepEqual(
    computeAutoTarget({ headVer: '1.0.1', headCode: 2, workVer: '1.1.0', workCode: 3 }),
    { version: '1.1.0', versionCode: 3, alreadyBumped: true }
  );
});

test('repository version metadata passes --check CLI gate', () => {
  const res = spawnSync(process.execPath, [path.join(process.cwd(), 'scripts', 'release-version.cjs'), '--check'], {
    encoding: 'utf8',
  });
  assert.equal(res.status, 0, res.stderr || res.stdout);
});

