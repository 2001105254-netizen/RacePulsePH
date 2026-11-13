#!/usr/bin/env node
'use strict';

// Read-only evidence contract. Does not certify visual quality or discover UI.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const CHECKS = ['spacing', 'layout', 'clipping', 'overlap', 'keyboard', 'focus',
  'touchTargets', 'contrast', 'content', 'theme', 'motion'];
const VIEWPORTS = [
  ['desktop-wide', 1440, 900], ['desktop', 1280, 800], ['tablet', 768, 1024],
  ['phone', 390, 844], ['narrow', 320, 568], ['landscape', 844, 390],
];
const text = (value) => typeof value === 'string' && value.trim().length > 0;
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const positive = (value) => Number.isFinite(value) && value > 0;
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

function requiredProfiles() {
  const profiles = [];
  for (const [prefix, width, height] of VIEWPORTS) {
    const variants = ['phone', 'desktop'].includes(prefix)
      ? ['default', 'text-spacing', 'text-resize-200', 'reduced-motion'] : ['default'];
    for (const theme of ['light', 'dark']) {
      for (const variant of variants) {
        profiles.push({ id: `${prefix}-${theme}${variant === 'default' ? '' : `-${variant}`}`,
          width, height, theme, variant });
      }
    }
  }
  return profiles;
}

function validate(inventory, evidence, options) {
  const issues = [];
  const fail = (message) => issues.push(message);
  const requireText = (value, label) => { if (!text(value)) fail(`${label}: required text missing`); };
  const list = (value, label) => {
    if (!Array.isArray(value)) { fail(`${label}: expected array`); return []; }
    return value;
  };
  const artifactRoot = path.resolve(options.artifactRoot);
  function artifact(ref, label, png = false) {
    if (!text(ref) || path.isAbsolute(ref)) { fail(`${label}: expected relative artifact path`); return null; }
    const full = path.resolve(artifactRoot, ref);
    const rel = path.relative(artifactRoot, full);
    if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
      fail(`${label}: artifact escapes evidence directory`); return null;
    }
    try {
      if (!fs.statSync(full).isFile() || fs.statSync(full).size === 0) throw new Error('empty or not a file');
      if (!png) return full;
      const buffer = Buffer.alloc(24);
      const fd = fs.openSync(full, 'r');
      let read;
      try { read = fs.readSync(fd, buffer, 0, 24, 0); } finally { fs.closeSync(fd); }
      if (read !== 24 || buffer.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a'
        || buffer.subarray(12, 16).toString('ascii') !== 'IHDR') throw new Error('not a PNG');
      return { full, width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
    } catch (error) { fail(`${label}: unavailable artifact (${error.message})`); return null; }
  }
  if (!object(inventory) || !object(evidence)) return { verdict: 'FAIL', issues: ['Expected JSON objects'] };
  if (inventory.schemaVersion !== 1 || evidence.schemaVersion !== 1) fail('schemaVersion must equal 1');
  requireText(inventory.sourceRevision, 'inventory.sourceRevision');
  if (evidence.sourceRevision !== inventory.sourceRevision) fail('Source revision mismatch');
  if (evidence.inventorySha256 !== options.inventorySha256) fail('Inventory fingerprint mismatch');
  requireText(evidence.runId, 'runId');
  if (!text(evidence.capturedAt) || !Number.isFinite(Date.parse(evidence.capturedAt))) fail('capturedAt must be a valid timestamp');
  if (inventory.discovery?.reconciled !== true) fail('Source/runtime discovery has not been reconciled');
  artifact(inventory.discovery?.log, 'discovery.log');
  artifact(inventory.discovery?.extraProfileReview, 'discovery.extraProfileReview');
  const sources = list(inventory.discovery?.sources, 'discovery.sources');
  if (!sources.length || sources.some((s) => !text(s))) fail('Discovery source list is empty or invalid');
  artifact(evidence.purposeLog, 'purposeLog');
  artifact(evidence.guidanceLog, 'guidanceLog');

  const profiles = new Map(requiredProfiles().map((p) => [p.id, p]));
  for (const extra of list(inventory.extraProfiles, 'extraProfiles')) {
    if (!object(extra) || !text(extra.id) || !Number.isInteger(extra.width) || extra.width < 1
      || !Number.isInteger(extra.height) || extra.height < 1 || !['light', 'dark'].includes(extra.theme)
      || !text(extra.variant)) { fail('Invalid extra profile'); continue; }
    if (profiles.has(extra.id)) fail(`Duplicate or overridden profile: ${extra.id}`);
    else profiles.set(extra.id, extra);
  }
  const surfaces = new Map();
  for (const surface of list(inventory.surfaces, 'surfaces')) {
    if (!object(surface) || !text(surface.id)) { fail('Invalid surface'); continue; }
    if (surfaces.has(surface.id)) { fail(`Duplicate surface: ${surface.id}`); continue; }
    for (const field of ['source', 'entry', 'role', 'state', 'purpose']) requireText(surface[field], `${surface.id}.${field}`);
    if (!text(surface.source) || !/:\d+$/.test(surface.source)) fail(`${surface.id}: source needs file:line`);
    const controls = list(surface.controls, `${surface.id}.controls`);
    if (!controls.length) requireText(surface.controlsEmptyReason, `${surface.id}.controlsEmptyReason`);
    const ids = new Set();
    for (const control of controls) {
      if (!object(control) || !text(control.id)) { fail(`${surface.id}: invalid control`); continue; }
      if (ids.has(control.id)) fail(`${surface.id}: duplicate control ${control.id}`);
      ids.add(control.id);
      requireText(control.action, `${surface.id}.${control.id}.action`);
      requireText(control.expected, `${surface.id}.${control.id}.expected`);
    }
    surfaces.set(surface.id, { ...surface, controlIds: ids });
  }
  if (!surfaces.size) fail('Zero surfaces cannot establish coverage');
  const commands = list(evidence.commands, 'commands');
  const commandNames = new Set();
  for (const command of commands) {
    if (!object(command) || !text(command.name)) { fail('Invalid command result'); continue; }
    if (commandNames.has(command.name)) fail(`Duplicate command result: ${command.name}`);
    commandNames.add(command.name);
    if (command.exitCode !== 0) fail(`Command ${command.name}: exit code is not 0`);
    artifact(command.log, `Command ${command.name}`);
  }
  for (const required of ['lint', 'build']) if (!commandNames.has(required)) fail(`Missing command: ${required}`);
  for (const finding of list(evidence.findings, 'findings')) {
    if (!object(finding) || finding.status !== 'resolved') fail(`Unresolved finding: ${finding?.id ?? 'unknown'}`);
    else artifact(finding.verification, `Finding ${finding.id} verification`);
  }
  if (list(evidence.blockers, 'blockers').length) fail('Unresolved blockers remain');

  const cases = list(evidence.cases, 'cases');
  const seen = new Set();
  const imagePaths = new Set();
  const counts = { required: surfaces.size * profiles.size, recorded: cases.length, passed: 0, failed: 0, blocked: 0, pending: 0, missing: 0 };
  for (const item of cases) {
    if (!object(item)) { fail('Invalid case'); continue; }
    const key = JSON.stringify([item.surfaceId, item.profileId]);
    const label = `${item.surfaceId}/${item.profileId}`;
    if (seen.has(key)) { fail(`Duplicate case: ${label}`); continue; }
    seen.add(key);
    const surface = surfaces.get(item.surfaceId);
    const profile = profiles.get(item.profileId);
    if (!surface || !profile) { fail(`Unknown surface/profile: ${label}`); continue; }
    if (item.status !== 'PASS') {
      if (item.status === 'BLOCKED') counts.blocked += 1;
      else if (item.status === 'PENDING') counts.pending += 1;
      else counts.failed += 1;
      fail(`${label}: status ${item.status ?? 'missing'}`);
      continue;
    }
    const before = issues.length;
    for (const field of ['width', 'height', 'theme', 'variant']) {
      if (item.observed?.[field] !== profile[field]) fail(`${label}: observed ${field} mismatch`);
    }
    requireText(item.observed?.url, `${label}.observed.url`);
    const screenshots = list(item.screenshots, `${label}.screenshots`);
    for (const kind of ['viewport', 'full-page']) {
      if (!screenshots.some((s) => s?.kind === kind)) fail(`${label}: missing ${kind} screenshot`);
    }
    for (const shot of screenshots) {
      if (!object(shot)) { fail(`${label}: invalid screenshot`); continue; }
      if (!['viewport', 'full-page', 'container'].includes(shot.kind)) fail(`${label}: unknown screenshot kind`);
      if (shot.inspected !== true) fail(`${label}: uninspected screenshot`);
      const png = artifact(shot.path, `${label} screenshot`, true);
      if (png) {
        const canonicalImage = fs.realpathSync(png.full);
        if (imagePaths.has(canonicalImage)) fail(`${label}: reused screenshot path`);
        imagePaths.add(canonicalImage);
        // Capture with scale: 'css' so these are CSS-pixel dimensions.
        if (shot.kind === 'viewport' && (png.width !== profile.width || png.height !== profile.height)) fail(`${label}: viewport screenshot dimensions mismatch`);
      }
    }
    for (const field of ['measurements', 'interactionLog', 'consoleLog']) artifact(item[field], `${label}.${field}`);
    for (const field of ['consoleErrors', 'pageErrors']) if (list(item[field], `${label}.${field}`).length) fail(`${label}: ${field} present`);
    if (!positive(item.geometry?.innerWidth) || !positive(item.geometry?.scrollWidth)
      || item.geometry.innerWidth !== profile.width || item.geometry.scrollWidth > item.geometry.innerWidth) fail(`${label}: overflow or missing geometry`);
    for (const check of CHECKS) if (item.checks?.[check] !== true) fail(`${label}: ${check} not verified`);
    const controlIds = new Set();
    for (const control of list(item.controls, `${label}.controls`)) {
      if (!object(control) || !surface.controlIds.has(control.id)) { fail(`${label}: unknown control`); continue; }
      if (controlIds.has(control.id)) fail(`${label}: duplicate control ${control.id}`);
      controlIds.add(control.id);
      if (control.status !== 'PASS') fail(`${label}: control ${control.id} not passed`);
      requireText(control.actual, `${label}.${control.id}.actual`);
      artifact(control.evidence, `${label}.${control.id}.evidence`);
    }
    for (const id of surface.controlIds) if (!controlIds.has(id)) fail(`${label}: missing control ${id}`);
    if (issues.length === before) counts.passed += 1;
    else counts.failed += 1;
  }
  for (const surface of surfaces.values()) {
    for (const profile of profiles.values()) {
      if (!seen.has(JSON.stringify([surface.id, profile.id]))) {
        counts.missing += 1;
        fail(`Missing case: ${surface.id}/${profile.id}`);
      }
    }
  }
  return { verdict: issues.length ? 'FAIL' : 'PASS', counts, issues,
    limitation: 'Evidence contract only. Source completeness, execution and visual inspection require direct review.' };
}

function main(args) {
  if (args.length !== 2) {
    process.stderr.write('Usage: node validate-audit.cjs <inventory.json> <evidence.json>\n');
    return 2;
  }
  try {
    const inventoryBytes = fs.readFileSync(args[0]);
    const inventory = JSON.parse(inventoryBytes.toString('utf8'));
    const evidence = JSON.parse(fs.readFileSync(args[1], 'utf8'));
    if (!object(inventory) || !object(evidence) || inventory.schemaVersion !== 1 || evidence.schemaVersion !== 1) throw new Error('Expected schemaVersion 1 JSON objects');
    const result = validate(inventory, evidence, { artifactRoot: path.dirname(path.resolve(args[1])), inventorySha256: sha256(inventoryBytes) });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result.verdict === 'PASS' ? 0 : 1;
  } catch (error) {
    process.stderr.write(`Audit input error: ${error.message}\n`);
    return 2;
  }
}

module.exports = { requiredProfiles, validate, sha256, CHECKS };
if (require.main === module) process.exitCode = main(process.argv.slice(2));
