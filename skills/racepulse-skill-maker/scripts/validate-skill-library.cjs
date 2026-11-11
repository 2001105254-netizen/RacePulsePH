#!/usr/bin/env node
'use strict';

/*
 * Read-only guard for the RacePulsePH skill library.
 * Exit codes: 0 = clean, 1 = a check failed, 2 = usage or registry load error.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const EM_DASH = '\u2014';
const RULE_ID = /^(R-(0[1-9]|[12]\d|3\d|40)|C-[1-5])$/;
const MAX_REPO_SKILL_LINES = 120;

const argv = process.argv.slice(2);
let root = process.cwd();
let asJson = false;
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === '--json') asJson = true;
  else if (argv[i] === '--root' && argv[i + 1]) root = path.resolve(argv[++i]);
  else usage(`Unknown or incomplete argument: ${argv[i]}`);
}

function usage(message) {
  process.stderr.write(`${message}\nUsage: validate-skill-library.cjs [--root <repo>] [--json]\n`);
  process.exit(2);
}

const results = [];
const record = (level, id, message) => results.push({ level, id, message });
const pass = (id, message) => record('PASS', id, message);
const fail = (id, message) => record('FAIL', id, message);
const warn = (id, message) => record('WARN', id, message);

function readText(file) {
  return fs.readFileSync(file, 'utf8');
}

function sha(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function listFiles(dir, base = dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full, base));
    else out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out.sort();
}

function parseFrontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!match) return null;
  const data = {};
  for (const line of match[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (!kv) continue;
    let value = kv[2].trim();
    if (/^".*"$/.test(value)) value = value.slice(1, -1);
    data[kv[1]] = value;
  }
  return data;
}

const registryPath = path.join(root, '.agents', 'skills', 'skills-library.json');
let lib;
try {
  lib = JSON.parse(readText(registryPath));
} catch (error) {
  usage(`Cannot load registry ${registryPath}: ${error.message}`);
}

const required = ['version', 'canonicalRoot', 'mirrorRoot', 'namingConvention', 'rulesSources', 'coreRules', 'projectGates', 'skills', 'backlog', 'deferredTopics', 'knownGaps'];
const missingTop = required.filter((key) => !(key in lib));
if (missingTop.length) usage(`Registry is missing fields: ${missingTop.join(', ')}`);

const canonical = path.join(root, lib.canonicalRoot);
const mirrorRoot = path.join(root, lib.mirrorRoot);
const prefix = lib.namingConvention.repoPrefix;
const exceptions = new Set(lib.namingConvention.allowedRepoExceptions || []);
const [descMin, descMax] = lib.namingConvention.descriptionLength;

// Rule sources exist.
for (const source of lib.rulesSources) {
  if (fs.existsSync(path.join(root, source))) pass('rules-source', `${source} exists`);
  else fail('rules-source', `${source} is missing`);
}

// Core rules match the installed antislop skill.
(function checkCore() {
  const coreDir = path.join(canonical, lib.coreRules.skill);
  const versionFile = path.join(coreDir, 'VERSION');
  const coreFile = path.join(coreDir, 'SKILL.md');
  if (!fs.existsSync(coreFile)) {
    fail('core-rules', `${lib.coreRules.skill}/SKILL.md is missing`);
    return;
  }
  if (fs.existsSync(versionFile)) {
    const installed = readText(versionFile).trim();
    if (installed === lib.coreRules.version) pass('core-version', `antislop ${installed}`);
    else fail('core-version', `registry says ${lib.coreRules.version}, installed is ${installed}`);
  } else {
    warn('core-version', 'antislop VERSION file not found');
  }

  const tierKeys = { 1: 'hardGate', 2: 'purposeGate', 3: 'qualityLocks' };
  const found = { hardGate: [], purposeGate: [], qualityLocks: [] };
  let tier = null;
  for (const line of readText(coreFile).split(/\r?\n/)) {
    const group = /^### Group (\d):/.exec(line);
    if (group) tier = tierKeys[group[1]] || null;
    const rule = /^#### (R-\d+)\b/.exec(line);
    if (rule && tier) found[tier].push(rule[1]);
  }
  for (const key of Object.keys(found)) {
    const actual = [...found[key]].sort().join(',');
    const expected = [...(lib.coreRules.tiers[key] || [])].sort().join(',');
    if (actual === expected) pass('core-tier', `${key}: ${found[key].length} rules match`);
    else fail('core-tier', `${key} differs. installed: ${actual || 'none'} registry: ${expected || 'none'}`);
  }
})();

// Project gates reference real rules.
for (const gate of lib.projectGates) {
  if (gate.rule && !RULE_ID.test(gate.rule)) fail('project-gate', `${gate.id} cites invalid rule ${gate.rule}`);
}

// Folders and registry agree.
const registered = new Map(lib.skills.map((skill) => [skill.name, skill]));
if (registered.size !== lib.skills.length) fail('registry', 'duplicate skill names');
const onDisk = fs.readdirSync(canonical, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(canonical, entry.name, 'SKILL.md')))
  .map((entry) => entry.name);
for (const name of onDisk) {
  if (!registered.has(name)) fail('registry', `${name} exists on disk but is not in skills-library.json`);
}
for (const skill of lib.skills) {
  if (!onDisk.includes(skill.name)) fail('registry', `${skill.name} is registered but has no SKILL.md`);
}

for (const skill of lib.skills) {
  const dir = path.join(canonical, skill.name);
  const skillFile = path.join(dir, 'SKILL.md');
  if (!fs.existsSync(skillFile)) continue;
  const id = `skill:${skill.name}`;
  const text = readText(skillFile);
  const front = parseFrontmatter(text);
  let ok = true;
  const bad = (message) => { ok = false; fail(id, message); };

  if (!front) bad('frontmatter missing');
  else {
    if (front.name !== skill.name) bad(`frontmatter name "${front.name}" differs from folder`);
    if (front.description !== skill.description) bad('registry description differs from frontmatter');
    if (skill.origin === 'repo' && (!front.description || front.description.length < descMin || front.description.length > descMax)) {
      bad(`description length must be ${descMin} to ${descMax}`);
    }
  }
  if (!['vendor', 'repo'].includes(skill.origin)) bad(`origin "${skill.origin}" must be vendor or repo`);
  if (!['active', 'deprecated'].includes(skill.status)) bad(`status "${skill.status}" must be active or deprecated`);
  for (const dep of skill.dependsOn || []) if (!registered.has(dep)) bad(`dependsOn "${dep}" is not registered`);
  for (const rule of skill.rules || []) if (!RULE_ID.test(rule)) bad(`invalid rule id ${rule}`);
  for (const ref of skill.references || []) if (!fs.existsSync(path.join(dir, 'references', ref))) bad(`references/${ref} is missing`);
  for (const script of skill.scripts || []) if (!fs.existsSync(path.join(dir, script))) bad(`${script} is missing`);

  if (skill.origin === 'repo') {
    if (!skill.name.startsWith(prefix) && !exceptions.has(skill.name)) {
      bad(`name must start with ${prefix} or be listed in namingConvention.allowedRepoExceptions`);
    }
    if (text.split(/\r?\n/).length > MAX_REPO_SKILL_LINES) bad(`SKILL.md exceeds ${MAX_REPO_SKILL_LINES} lines`);

    const mdFiles = listFiles(dir).filter((file) => file.endsWith('.md'));
    for (const file of mdFiles) {
      const body = readText(path.join(dir, file));
      if (body.includes(EM_DASH)) bad(`${file} contains an em dash (R-02)`);
      const linkPattern = /\]\((?!https?:|mailto:|#)([^)\s#]+)(?:#[^)]*)?\)/g;
      let link;
      while ((link = linkPattern.exec(body))) {
        if (link[1].includes('[')) continue;
        const target = path.resolve(path.dirname(path.join(dir, file)), link[1]);
        if (!fs.existsSync(target)) bad(`${file} links to missing ${link[1]}`);
      }
      const cited = body.match(/\bR-\d{2}\b/g) || [];
      for (const rule of cited) if (!RULE_ID.test(rule)) bad(`${file} cites unknown rule ${rule}`);
    }

    if (!skill.mirror) bad('repo skill needs a mirror path');
    else {
      const mirrorDir = path.join(root, skill.mirror);
      if (!fs.existsSync(mirrorDir)) bad(`mirror ${skill.mirror} is missing`);
      else {
        const source = listFiles(dir);
        const copy = listFiles(mirrorDir);
        for (const file of source) {
          if (!copy.includes(file)) bad(`mirror lacks ${file}`);
          else if (sha(path.join(dir, file)) !== sha(path.join(mirrorDir, file))) bad(`mirror differs: ${file}`);
        }
        for (const file of copy) if (!source.includes(file)) bad(`mirror has extra ${file}`);
      }
    }
  } else if (skill.mirror) {
    warn(id, 'vendor skill should not be mirrored');
  }
  if (ok) pass(id, 'registered, frontmatter and files consistent');
}

// Backlog.
const backlogNames = new Set();
for (const item of lib.backlog) {
  const id = `backlog:${item.name}`;
  if (backlogNames.has(item.name)) fail(id, 'duplicate backlog name');
  backlogNames.add(item.name);
  if (registered.has(item.name)) fail(id, 'already a registered skill, remove from backlog');
  else if (!item.name.startsWith(prefix)) fail(id, `name must start with ${prefix}`);
  else if (item.status !== 'planned') fail(id, 'status must be planned');
  else if (!Array.isArray(item.items) || !item.items.length || !Array.isArray(item.sources) || !item.sources.length) fail(id, 'needs items and sources');
  else pass(id, `${item.items.length} items from ${item.sources.length} source(s)`);
}

const failures = results.filter((entry) => entry.level === 'FAIL').length;
const warnings = results.filter((entry) => entry.level === 'WARN').length;
const code = failures ? 1 : 0;

if (asJson) {
  process.stdout.write(`${JSON.stringify({ exitCode: code, failures, warnings, results }, null, 2)}\n`);
} else {
  for (const entry of results) process.stdout.write(`${entry.level.padEnd(4)} ${entry.id}: ${entry.message}\n`);
  process.stdout.write(`\n${results.length} checks, ${failures} failed, ${warnings} warnings. Exit ${code}.\n`);
}
process.exit(code);
