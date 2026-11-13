'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { spawnSync } = require('node:child_process');
const { requiredProfiles, validate, sha256, CHECKS } = require('../skills/racepulse-all-screen-audit/scripts/validate-audit.cjs');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'racepulse-audit-contract-'));
after(() => fs.rmSync(dir, { recursive: true, force: true }));

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function png(width, height) {
  function chunk(type, data) {
    const name = Buffer.from(type);
    const size = Buffer.alloc(4); size.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
    return Buffer.concat([size, name, data, crc]);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 0;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(Buffer.alloc((width + 1) * height))), chunk('IEND', Buffer.alloc(0))]);
}
// Synthetic artifacts test the contract, never the application or visual quality.
fs.writeFileSync(path.join(dir, 'evidence.log'), 'Synthetic contract fixture; not an application audit.');
const inventory = {
  schemaVersion: 1, sourceRevision: 'fixture-revision',
  discovery: { reconciled: true, log: 'evidence.log', sources: ['fixture.tsx'], extraProfileReview: 'evidence.log' },
  extraProfiles: [],
  surfaces: [{ id: 'fixture', source: 'fixture.tsx:1', entry: 'Fixture only', role: 'guest', state: 'ready', purpose: 'Exercise validator',
    controls: [{ id: 'open', action: 'Open', expected: 'Dialog appears' }] }],
};
const inventoryBytes = Buffer.from(JSON.stringify(inventory));
const evidence = {
  schemaVersion: 1, inventorySha256: sha256(inventoryBytes), sourceRevision: inventory.sourceRevision,
  runId: 'fixture', capturedAt: '2026-11-13T12:00:00Z',
  purposeLog: 'evidence.log', guidanceLog: 'evidence.log', findings: [], blockers: [],
  commands: ['lint', 'build'].map((name) => ({ name, exitCode: 0, log: 'evidence.log' })),
  cases: requiredProfiles().map((profile) => {
    const screenshots = ['viewport', 'full-page'].map((kind) => {
      const file = `${profile.id}-${kind}.png`;
      fs.writeFileSync(path.join(dir, file), png(profile.width, profile.height));
      return { path: file, kind, inspected: true };
    });
    return { surfaceId: 'fixture', profileId: profile.id, status: 'PASS',
      observed: { ...profile, url: 'http://fixture.invalid' }, screenshots,
      measurements: 'evidence.log', interactionLog: 'evidence.log', consoleLog: 'evidence.log',
      consoleErrors: [], pageErrors: [], geometry: { innerWidth: profile.width, scrollWidth: profile.width },
      checks: Object.fromEntries(CHECKS.map((check) => [check, true])),
      controls: [{ id: 'open', status: 'PASS', actual: 'Synthetic result', evidence: 'evidence.log' }] };
  }),
};
const options = { artifactRoot: dir, inventorySha256: sha256(inventoryBytes) };

test('requires 24 distinct profiles, including both themes and resilience variants', () => {
  assert.equal(requiredProfiles().length, 24);
  assert.equal(new Set(requiredProfiles().map((p) => p.id)).size, 24);
});
test('accepts a complete synthetic evidence contract without claiming app quality', () => {
  const result = validate(inventory, evidence, options);
  assert.equal(result.verdict, 'PASS', JSON.stringify(result.issues));
  assert.equal(result.counts.passed, 24);
  assert.match(result.limitation, /direct review/);
});

const mutations = [
  ['missing screen', (i) => i.surfaces.push({ ...i.surfaces[0], id: 'unvisited' }), /Missing case: unvisited/],
  ['missing profile', (_, e) => e.cases.pop(), /Missing case/],
  ['blocked case', (_, e) => { e.cases[0].status = 'BLOCKED'; }, /status BLOCKED/],
  ['skipped case', (_, e) => { e.cases[0].status = 'SKIP'; }, /status SKIP/],
  ['pending case', (_, e) => { e.cases[0].status = 'PENDING'; }, /status PENDING/],
  ['duplicate case', (_, e) => e.cases.push(e.cases[0]), /Duplicate case/],
  ['unknown case', (_, e) => { e.cases[0].surfaceId = 'unknown'; }, /Unknown surface/],
  ['wrong theme', (_, e) => { e.cases[0].observed.theme = 'dark'; }, /observed theme mismatch/],
  ['wrong viewport image', (_, e) => { e.cases[0].screenshots[0].path = 'phone-light-viewport.png'; }, /dimensions mismatch/],
  ['uninspected screenshot', (_, e) => { e.cases[0].screenshots[0].inspected = false; }, /uninspected/],
  ['missing screenshot', (_, e) => { e.cases[0].screenshots[0].path = 'absent.png'; }, /unavailable artifact/],
  ['fake screenshot format', (_, e) => { e.cases[0].screenshots[0].path = 'evidence.log'; }, /not a PNG/],
  ['reused screenshot', (_, e) => { e.cases[1].screenshots[0].path = e.cases[0].screenshots[0].path; }, /reused screenshot/],
  ['missing control', (_, e) => { e.cases[0].controls = []; }, /missing control/],
  ['unproven control', (_, e) => { e.cases[0].controls[0].actual = ''; }, /actual: required/],
  ['overflow', (_, e) => { e.cases[0].geometry.scrollWidth += 1; }, /overflow/],
  ['failed visual check', (_, e) => { e.cases[0].checks.spacing = false; }, /spacing not verified/],
  ['console error', (_, e) => e.cases[0].consoleErrors.push('Error'), /consoleErrors present/],
  ['build failure', (_, e) => { e.commands[1].exitCode = 1; }, /exit code is not 0/],
  ['missing build', (_, e) => e.commands.pop(), /Missing command: build/],
  ['stale inventory', (_, e) => { e.inventorySha256 = 'stale'; }, /fingerprint mismatch/],
  ['stale revision', (_, e) => { e.sourceRevision = 'stale'; }, /revision mismatch/],
  ['unreconciled inventory', (i) => { i.discovery.reconciled = false; }, /not been reconciled/],
  ['empty inventory', (i) => { i.surfaces = []; }, /Zero surfaces/],
  ['open finding', (_, e) => e.findings.push({ id: 'F1', status: 'open' }), /Unresolved finding/],
  ['missing resolution proof', (_, e) => e.findings.push({ id: 'F1', status: 'resolved', verification: 'absent.log' }), /unavailable artifact/],
  ['blocked native coverage', (_, e) => e.blockers.push('Android keyboard unavailable'), /Unresolved blockers/],
  ['unrun breakpoint profile', (i) => i.extraProfiles.push({ id: 'breakpoint', width: 767, height: 1024, theme: 'light', variant: 'default' }), /Missing case.*breakpoint/],
  ['base profile override', (i) => i.extraProfiles.push({ ...requiredProfiles()[0], width: 10 }), /overridden profile/],
  ['artifact path escape', (_, e) => { e.purposeLog = '../elsewhere.log'; }, /escapes evidence directory/],
];
for (const [name, mutate, expected] of mutations) {
  test(`rejects ${name}`, () => {
    const i = structuredClone(inventory); const e = structuredClone(evidence);
    mutate(i, e);
    const result = validate(i, e, options);
    assert.equal(result.verdict, 'FAIL');
    assert.match(result.issues.join('\n'), expected);
  });
}

test('CLI returns 0 for complete evidence, 1 for incomplete, 2 for malformed input or usage', () => {
  const script = path.resolve(__dirname, '../skills/racepulse-all-screen-audit/scripts/validate-audit.cjs');
  const input = path.join(dir, 'inventory.json'); const output = path.join(dir, 'evidence.json');
  fs.writeFileSync(input, inventoryBytes); fs.writeFileSync(output, JSON.stringify(evidence));
  const run = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
  assert.equal(run(input, output).status, 0);
  fs.writeFileSync(output, JSON.stringify({ ...evidence, cases: [] }));
  assert.equal(run(input, output).status, 1);
  fs.writeFileSync(output, '{broken');
  assert.equal(run(input, output).status, 2);
  assert.equal(run().status, 2);
});
