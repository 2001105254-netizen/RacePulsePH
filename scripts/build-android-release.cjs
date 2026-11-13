#!/usr/bin/env node
'use strict';

/**
 * Builds and stages RacePulsePH Android release artifacts (RacePulsePH.apk & RacePulsePH.aab)
 * with version parity checks, Capacitor sync, APK signature verification, and SHA-256 checksums.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { cleanAndroidWebAssets } = require('./clean-android-web-assets.cjs');

const ROOT = process.cwd();
const isWin = process.platform === 'win32';
const requireSigned = process.argv.includes('--require-signed');
const skipWebSync = process.argv.includes('--skip-web-sync');

function resolveAndroidSdk() {
  const candidates = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk') : null,
  ].filter(Boolean);
  for (const dir of candidates) {
    if (fs.existsSync(dir)) return dir;
  }
  return null;
}

function run(cmd, args, cwd = ROOT, extraEnv = {}) {
  const invocation = isWin ? [cmd, ...args.map((a) => (/\s/.test(a) ? `"${a}"` : a))].join(' ') : cmd;
  const res = spawnSync(invocation, isWin ? [] : args, {
    cwd,
    stdio: 'inherit',
    shell: isWin,
    env: { ...process.env, ...extraEnv },
  });
  if (res.status !== 0) {
    throw new Error(`Command failed (${res.status}): ${cmd} ${args.join(' ')}`);
  }
}

function loadLocalKeystoreFile() {
  const file = path.join(ROOT, 'signing', 'keystore.txt');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = /^\s*(KEYSTORE_[A-Z_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[1] === 'KEYSTORE_PATH' ? path.resolve(ROOT, match[2]) : match[2];
  }
}
loadLocalKeystoreFile();

function readGradleProp(key) {
  const userProps = path.join(process.env.USERPROFILE || process.env.HOME || '', '.gradle', 'gradle.properties');
  const projectProps = path.join(ROOT, 'android', 'gradle.properties');
  for (const file of [projectProps, userProps]) {
    if (!file || !fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    const re = new RegExp(`^\\s*${key}\\s*=\\s*(.+)$`, 'm');
    const match = re.exec(text);
    if (match && match[1].trim()) return match[1].trim();
  }
  return null;
}

function hasSigningConfig() {
  const storePath = process.env.KEYSTORE_PATH || readGradleProp('RELEASE_STORE_FILE');
  const storePassword = process.env.KEYSTORE_PASSWORD || readGradleProp('RELEASE_STORE_PASSWORD');
  const keyAlias = process.env.KEYSTORE_ALIAS || readGradleProp('RELEASE_KEY_ALIAS');
  return {
    configured: Boolean(storePath && storePassword && keyAlias),
    storePath,
  };
}

function findApksigner(sdkRoot) {
  if (!sdkRoot) return null;
  const btDir = path.join(sdkRoot, 'build-tools');
  if (!fs.existsSync(btDir)) return null;
  const versions = fs.readdirSync(btDir).sort((a, b) => {
    const pa = a.split('.').map((n) => Number(n) || 0);
    const pb = b.split('.').map((n) => Number(n) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
      if ((pb[i] || 0) !== (pa[i] || 0)) return (pb[i] || 0) - (pa[i] || 0);
    }
    return 0;
  });
  for (const v of versions) {
    const bin = path.join(btDir, v, isWin ? 'apksigner.bat' : 'apksigner');
    if (fs.existsSync(bin)) return bin;
  }
  return null;
}

function findJarsigner() {
  const exe = isWin ? 'jarsigner.exe' : 'jarsigner';
  const homes = [process.env.JAVA_HOME, 'C:\\Program Files\\Android\\Android Studio\\jbr'].filter(Boolean);
  for (const home of homes) {
    const bin = path.join(home, 'bin', exe);
    if (fs.existsSync(bin)) return bin;
  }
  return 'jarsigner';
}

const PLAY_UPLOAD_SHA1 = '0F:9E:41:87:5A:37:C3:41:8E:24:23:9A:56:53:EF:F7:FC:C1:4D:07';

function assertPlayUploadKey(aabFile) {
  const jarsigner = findJarsigner();
  const keytool = path.join(path.dirname(jarsigner), isWin ? 'keytool.exe' : 'keytool');
  const res = spawnSync(fs.existsSync(keytool) ? keytool : 'keytool', ['-printcert', '-jarfile', aabFile], { encoding: 'utf8' });
  const match = /SHA1:\s*([0-9A-F:]{59})/i.exec(`${res.stdout}\n${res.stderr}`);
  if (!match || match[1].toUpperCase() !== PLAY_UPLOAD_SHA1) {
    throw new Error(`AAB certificate SHA1 ${match ? match[1] : 'unreadable'} does not match the Play upload key ${PLAY_UPLOAD_SHA1}. Do not upload it.`);
  }
  process.stdout.write(`PASS: AAB certificate SHA1 matches the Play upload key (${PLAY_UPLOAD_SHA1}).\n`);
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function main() {
  run('node', ['scripts/release-version.cjs', '--check']);

  const signing = hasSigningConfig();
  if (!signing.configured) {
    const hint =
      'Missing release keystore configuration (KEYSTORE_PATH, KEYSTORE_PASSWORD, KEYSTORE_ALIAS, KEYSTORE_ALIAS_PASSWORD).';
    if (requireSigned) {
      throw new Error(hint);
    }
    process.stdout.write(`WARN: ${hint} Building unsigned artifacts.\n`);
  }

  if (!skipWebSync) {
    run('npm', ['run', 'android:sync']);
  }
  cleanAndroidWebAssets();

  const sdkRoot = resolveAndroidSdk();
  const gradleEnv = sdkRoot ? { ANDROID_HOME: sdkRoot, ANDROID_SDK_ROOT: sdkRoot } : {};
  const gradlew = isWin ? '.\\gradlew.bat' : './gradlew';
  run(gradlew, ['assembleRelease', 'bundleRelease', '--no-daemon'], path.join(ROOT, 'android'), gradleEnv);

  const apkOutDir = path.join(ROOT, 'android', 'app', 'build', 'outputs', 'apk', 'release');
  const bundleOutDir = path.join(ROOT, 'android', 'app', 'build', 'outputs', 'bundle', 'release');

  const apkFile = path.join(apkOutDir, 'RacePulsePH.apk');
  const aabFile = path.join(bundleOutDir, 'RacePulsePH.aab');

  if (!fs.existsSync(apkFile)) {
    throw new Error(`Expected APK missing at ${apkFile}`);
  }
  if (!fs.existsSync(aabFile)) {
    throw new Error(`Expected AAB missing at ${aabFile}`);
  }

  if (signing.configured) {
    const apksigner = findApksigner(sdkRoot);
    if (!apksigner) {
      throw new Error('apksigner not found under ANDROID_HOME/build-tools to verify release APK signature.');
    }
    run(apksigner, ['verify', '--verbose', '--print-certs', apkFile]);
    const jarVerify = spawnSync(findJarsigner(), ['-verify', aabFile], { encoding: 'utf8' });
    process.stdout.write(jarVerify.stdout || '');
    process.stderr.write(jarVerify.stderr || '');
    if (jarVerify.status !== 0 || /jar is unsigned/i.test(`${jarVerify.stdout}\n${jarVerify.stderr}`)) {
      throw new Error(`AAB signature verification failed for ${aabFile}`);
    }
  }

  const stageDir = path.join(ROOT, 'release', 'android');
  assertPlayUploadKey(aabFile);
  fs.mkdirSync(stageDir, { recursive: true });
  const stagedApk = path.join(stageDir, 'RacePulsePH.apk');
  const stagedAab = path.join(stageDir, 'RacePulsePH.aab');
  fs.copyFileSync(apkFile, stagedApk);
  fs.copyFileSync(aabFile, stagedAab);

  const apkHash = sha256File(stagedApk);
  const aabHash = sha256File(stagedAab);
  fs.writeFileSync(path.join(stageDir, 'RacePulsePH.apk.sha256'), `${apkHash}  RacePulsePH.apk\n`, 'utf8');
  fs.writeFileSync(path.join(stageDir, 'RacePulsePH.aab.sha256'), `${aabHash}  RacePulsePH.aab\n`, 'utf8');
  fs.writeFileSync(
    path.join(stageDir, 'SHA256SUMS.txt'),
    `${apkHash}  RacePulsePH.apk\n${aabHash}  RacePulsePH.aab\n`,
    'utf8'
  );

  process.stdout.write(`Staged release artifacts in ${stageDir}:\n- RacePulsePH.apk (${apkHash})\n- RacePulsePH.aab (${aabHash})\n`);
}

main();
