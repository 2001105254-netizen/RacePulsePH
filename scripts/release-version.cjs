#!/usr/bin/env node
'use strict';

/**
 * Synchronizes RacePulsePH SemVer and Android versionCode across package.json,
 * package-lock.json, android/app/build.gradle, and the Windows installer script.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = process.cwd();
const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)$/;

const PATHS = {
  pkg: 'package.json',
  lock: 'package-lock.json',
  gradle: 'android/app/build.gradle',
  iss: 'rfid-station/RacePulseTimingStation.iss',
};

function readUtf8(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

function writeWithEol(relPath, content, preferLf = false) {
  const full = path.join(ROOT, relPath);
  const existing = fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : '';
  const eol = !preferLf && existing.includes('\r\n') ? '\r\n' : '\n';
  const normalized = content.replace(/\r?\n/g, eol);
  fs.writeFileSync(full, normalized.endsWith(eol) ? normalized : `${normalized}${eol}`, 'utf8');
}

function parseSemver(version) {
  const m = SEMVER_RE.exec(String(version || '').trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function compareSemver(a, b) {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return 0;
  for (let i = 0; i < 3; i += 1) {
    if (pa[i] !== pb[i]) return pa[i] > pb[i] ? 1 : -1;
  }
  return 0;
}

function bumpSemver(version, kind) {
  const parsed = parseSemver(version);
  if (!parsed) throw new Error(`Invalid SemVer string: "${version}"`);
  const [major, minor, patch] = parsed;
  if (kind === 'major') return `${major + 1}.0.0`;
  if (kind === 'minor') return `${major}.${minor + 1}.0`;
  if (kind === 'patch') return `${major}.${minor}.${patch + 1}`;
  throw new Error(`Unknown bump kind: ${kind}`);
}

function parseGradleVersion(gradleText) {
  const codeMatch = /^\s*versionCode\s+(\d+)\b/m.exec(gradleText);
  const nameMatch = /^\s*versionName\s+"([^"]+)"/m.exec(gradleText);
  return {
    versionCode: codeMatch ? Number(codeMatch[1]) : null,
    versionName: nameMatch ? nameMatch[1].trim() : null,
  };
}

function parseIssVersion(issText) {
  const m = /^#define\s+AppVersion\s+"([^"]+)"/m.exec(issText);
  return m ? m[1].trim() : null;
}

function gitShowText(refPath) {
  const res = spawnSync('git', ['show', `HEAD:${refPath}`], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  return res.status === 0 ? res.stdout : null;
}

function readState() {
  const pkg = JSON.parse(readUtf8(PATHS.pkg));
  const gradleText = readUtf8(PATHS.gradle);
  const gradleVer = parseGradleVersion(gradleText);
  const issText = fs.existsSync(path.join(ROOT, PATHS.iss)) ? readUtf8(PATHS.iss) : '';
  const lockText = fs.existsSync(path.join(ROOT, PATHS.lock)) ? readUtf8(PATHS.lock) : null;
  const lock = lockText ? JSON.parse(lockText) : null;

  return {
    pkgName: pkg.name,
    pkgVersion: pkg.version,
    lockVersion: lock ? lock.version : null,
    lockRootPackageVersion: lock?.packages?.['']?.version || null,
    gradleVersionCode: gradleVer.versionCode,
    gradleVersionName: gradleVer.versionName,
    issVersion: issText ? parseIssVersion(issText) : null,
  };
}

function writeState(nextVersion, nextCode) {
  if (!parseSemver(nextVersion)) {
    throw new Error(`Target version must be X.Y.Z SemVer, got "${nextVersion}"`);
  }
  if (!Number.isInteger(nextCode) || nextCode < 1) {
    throw new Error(`Target versionCode must be a positive integer, got "${nextCode}"`);
  }

  const pkg = JSON.parse(readUtf8(PATHS.pkg));
  pkg.version = nextVersion;
  writeWithEol(PATHS.pkg, JSON.stringify(pkg, null, 2));

  if (fs.existsSync(path.join(ROOT, PATHS.lock))) {
    const lock = JSON.parse(readUtf8(PATHS.lock));
    lock.name = pkg.name;
    lock.version = nextVersion;
    if (lock.packages && lock.packages['']) {
      lock.packages[''].name = pkg.name;
      lock.packages[''].version = nextVersion;
    }
    writeWithEol(PATHS.lock, JSON.stringify(lock, null, 2));
  }

  let gradleText = readUtf8(PATHS.gradle);
  if (!/^\s*versionCode\s+\d+\b/m.test(gradleText) || !/^\s*versionName\s+"[^"]+"/m.test(gradleText)) {
    throw new Error(`Could not locate versionCode/versionName in ${PATHS.gradle}`);
  }
  gradleText = gradleText
    .replace(/^(\s*versionCode\s+)\d+/m, `$1${nextCode}`)
    .replace(/^(\s*versionName\s+)"[^"]+"/m, `$1"${nextVersion}"`);
  writeWithEol(PATHS.gradle, gradleText);

  if (fs.existsSync(path.join(ROOT, PATHS.iss))) {
    let issText = readUtf8(PATHS.iss);
    if (/^#define\s+AppVersion\s+"[^"]+"/m.test(issText)) {
      issText = issText.replace(/^(#define\s+AppVersion\s+)"[^"]+"/m, `$1"${nextVersion}"`);
      writeWithEol(PATHS.iss, issText);
    }
  }
}

function checkParity(state) {
  const issues = [];
  if (!parseSemver(state.pkgVersion)) {
    issues.push(`package.json version "${state.pkgVersion}" is not X.Y.Z SemVer`);
  }
  if (state.lockVersion !== null && state.lockVersion !== state.pkgVersion) {
    issues.push(`package-lock.json version "${state.lockVersion}" != "${state.pkgVersion}"`);
  }
  if (state.lockRootPackageVersion !== null && state.lockRootPackageVersion !== state.pkgVersion) {
    issues.push(`package-lock.json packages[""].version "${state.lockRootPackageVersion}" != "${state.pkgVersion}"`);
  }
  if (!Number.isInteger(state.gradleVersionCode) || state.gradleVersionCode < 1) {
    issues.push(`android/app/build.gradle versionCode "${state.gradleVersionCode}" must be >= 1`);
  }
  if (state.gradleVersionName !== state.pkgVersion) {
    issues.push(`android/app/build.gradle versionName "${state.gradleVersionName}" != "${state.pkgVersion}"`);
  }
  if (state.issVersion !== null && state.issVersion !== state.pkgVersion) {
    issues.push(`rfid-station/RacePulseTimingStation.iss AppVersion "${state.issVersion}" != "${state.pkgVersion}"`);
  }
  return issues;
}

function computeAutoTarget({ headVer, headCode, workVer, workCode }) {
  const safeHeadVer = parseSemver(headVer) ? headVer : '1.0.0';
  const safeHeadCode = Number.isInteger(headCode) ? headCode : 0;
  const safeWorkVer = parseSemver(workVer) ? workVer : safeHeadVer;
  const safeWorkCode = Number.isInteger(workCode) ? workCode : safeHeadCode;

  const alreadyBumped = compareSemver(safeWorkVer, safeHeadVer) > 0 && safeWorkCode > safeHeadCode;
  const baseVer = compareSemver(safeWorkVer, safeHeadVer) >= 0 ? safeWorkVer : safeHeadVer;
  return {
    version: alreadyBumped ? safeWorkVer : bumpSemver(baseVer, 'patch'),
    versionCode: alreadyBumped ? safeWorkCode : Math.max(safeHeadCode, safeWorkCode) + 1,
    alreadyBumped,
  };
}

function stageVersionFiles() {
  const existing = Object.values(PATHS).filter((rel) => fs.existsSync(path.join(ROOT, rel)));
  const res = spawnSync('git', ['add', '--', ...existing], {
    cwd: ROOT,
    stdio: 'inherit',
  });
  if (res.status !== 0) {
    throw new Error(`git add failed with exit code ${res.status}`);
  }
}

function main() {
  const args = process.argv.slice(2);
  let mode = 'json';
  let setVersion = null;
  let stage = false;
  let asJson = false;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--check' || arg === '--sync' || arg === '--auto' || arg === '--patch' || arg === '--minor' || arg === '--major') {
      mode = arg.slice(2);
    } else if (arg === '--set' && args[i + 1]) {
      mode = 'set';
      setVersion = args[++i];
    } else if (arg === '--stage') {
      stage = true;
    } else if (arg === '--json') {
      asJson = true;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  const state = readState();

  if (mode === 'json') {
    process.stdout.write(
      `${JSON.stringify({ name: state.pkgName, appName: 'RacePulsePH', version: state.pkgVersion, versionCode: state.gradleVersionCode })}\n`
    );
    return;
  }

  if (mode === 'check') {
    const issues = checkParity(state);
    if (issues.length > 0) {
      for (const issue of issues) process.stderr.write(`FAIL: ${issue}\n`);
      process.exit(1);
    }
    if (asJson) {
      process.stdout.write(
        `${JSON.stringify({ ok: true, version: state.pkgVersion, versionCode: state.gradleVersionCode })}\n`
      );
    } else {
      process.stdout.write(`PASS: RacePulsePH version ${state.pkgVersion} (versionCode ${state.gradleVersionCode}) synchronized.\n`);
    }
    return;
  }

  if (mode === 'sync') {
    const nextCode = state.gradleVersionCode && state.gradleVersionCode >= 1 ? state.gradleVersionCode : 1;
    writeState(state.pkgVersion, nextCode);
  } else if (mode === 'set') {
    const nextCode = (state.gradleVersionCode || 0) + 1;
    writeState(setVersion, nextCode);
  } else if (mode === 'patch' || mode === 'minor' || mode === 'major') {
    const nextVersion = bumpSemver(state.pkgVersion, mode);
    const nextCode = (state.gradleVersionCode || 0) + 1;
    writeState(nextVersion, nextCode);
  } else if (mode === 'auto') {
    const headPkgText = gitShowText(PATHS.pkg);
    const headGradleText = gitShowText(PATHS.gradle);
    const headPkg = headPkgText ? JSON.parse(headPkgText) : null;
    const headGradle = headGradleText ? parseGradleVersion(headGradleText) : { versionCode: 0, versionName: '0.0.0' };

    const target = computeAutoTarget({
      headVer: headPkg ? headPkg.version : null,
      headCode: headGradle.versionCode,
      workVer: state.pkgVersion,
      workCode: state.gradleVersionCode,
    });
    writeState(target.version, target.versionCode);
  }

  const updated = readState();
  if (stage) stageVersionFiles();

  if (asJson) {
    process.stdout.write(
      `${JSON.stringify({ version: updated.pkgVersion, versionCode: updated.gradleVersionCode })}\n`
    );
  } else {
    process.stdout.write(`RacePulsePH version -> ${updated.pkgVersion} (versionCode ${updated.gradleVersionCode})\n`);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  parseSemver,
  compareSemver,
  bumpSemver,
  parseGradleVersion,
  parseIssVersion,
  checkParity,
  computeAutoTarget,
};
