#!/usr/bin/env node
'use strict';

/**
 * Strips server-only Node bundles and non-app artifacts from Android's synced web assets
 * so Capacitor APK/AAB builds ship only client-facing files.
 */

const fs = require('fs');
const path = require('path');

const ANDROID_PUBLIC_DIR = path.join(process.cwd(), 'android', 'app', 'src', 'main', 'assets', 'public');
const FORBIDDEN_FILES = [
  'server.cjs',
  'server.cjs.map',
  path.join('assets', 'google-play-feature-graphic.png'),
];

function cleanAndroidWebAssets() {
  if (!fs.existsSync(ANDROID_PUBLIC_DIR)) return [];
  const removed = [];
  for (const relPath of FORBIDDEN_FILES) {
    const fullPath = path.join(ANDROID_PUBLIC_DIR, relPath);
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
      removed.push(relPath);
    }
  }
  return removed;
}

if (require.main === module) {
  const removed = cleanAndroidWebAssets();
  if (removed.length > 0) {
    process.stdout.write(`Removed server/non-app Android web assets: ${removed.join(', ')}\n`);
  }
}

module.exports = { cleanAndroidWebAssets };
