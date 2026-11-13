#!/usr/bin/env node
'use strict';

/**
 * Downloads the CI-signed RacePulsePH.aab for the current package.json version from GitHub
 * Releases into release/play/ and refuses it unless its signing certificate SHA1 matches the
 * upload key registered in Play Console. Upload only the file this script prints.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = process.cwd();
const isWin = process.platform === 'win32';
const EXPECTED_SHA1 = '0F:9E:41:87:5A:37:C3:41:8E:24:23:9A:56:53:EF:F7:FC:C1:4D:07';

function findKeytool() {
  const exe = isWin ? 'keytool.exe' : 'keytool';
  const homes = [process.env.JAVA_HOME, 'C:\\Program Files\\Android\\Android Studio\\jbr'].filter(Boolean);
  for (const home of homes) {
    const bin = path.join(home, 'bin', exe);
    if (fs.existsSync(bin)) return bin;
  }
  return 'keytool';
}

function fail(message) {
  process.stderr.write(`FAIL: ${message}\n`);
  process.exit(1);
}

const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const tag = `v${version}`;
const outDir = path.join(ROOT, 'release', 'play');
fs.mkdirSync(outDir, { recursive: true });

const download = spawnSync('gh', ['release', 'download', tag, '--pattern', 'RacePulsePH.aab', '--dir', 'release/play', '--clobber'], {
  encoding: 'utf8',
  shell: isWin,
});
if (download.status !== 0) {
  fail(`could not download RacePulsePH.aab from release ${tag}. Wait for the CI release job to finish. ${download.stderr || ''}`);
}

const aab = path.join(outDir, 'RacePulsePH.aab');
const cert = spawnSync(findKeytool(), ['-printcert', '-jarfile', aab], { encoding: 'utf8' });
const match = /SHA1:\s*([0-9A-F:]{59})/i.exec(`${cert.stdout}\n${cert.stderr}`);
if (!match) fail(`could not read the signing certificate of ${aab}.`);
if (match[1].toUpperCase() !== EXPECTED_SHA1) {
  fs.rmSync(aab, { force: true });
  fail(`signed with ${match[1]}, Play expects ${EXPECTED_SHA1}. File deleted. Do not upload a locally built AAB.`);
}

process.stdout.write(`PASS: ${aab}\nversion ${version}, certificate SHA1 ${match[1]} matches the Play upload key.\n`);
