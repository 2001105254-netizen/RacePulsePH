#!/usr/bin/env node
'use strict';

/**
 * Configures Git to run tracked hooks from .githooks/ on this clone.
 * Safe to invoke from npm prepare in environments without a .git directory.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = process.cwd();
const gitDir = path.join(root, '.git');
const hookFile = path.join(root, '.githooks', 'pre-commit');

if (!fs.existsSync(gitDir) || !fs.existsSync(hookFile)) {
  process.exit(0);
}

try {
  fs.chmodSync(hookFile, 0o755);
} catch {
  // Windows ignores POSIX mode bits cleanly.
}

const current = spawnSync('git', ['config', '--local', '--get', 'core.hooksPath'], {
  cwd: root,
  encoding: 'utf8',
});

if (current.error) {
  process.exit(0);
}

if (current.status !== 0 || current.stdout.trim() !== '.githooks') {
  const set = spawnSync('git', ['config', '--local', 'core.hooksPath', '.githooks'], {
    cwd: root,
    stdio: 'inherit',
  });
  if (set.error) {
    process.exit(0);
  }
  if (set.status !== 0) {
    process.exit(set.status || 1);
  }
}

process.stdout.write('Git hooks configured: core.hooksPath -> .githooks\n');
