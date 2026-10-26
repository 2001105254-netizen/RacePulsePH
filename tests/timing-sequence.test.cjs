const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

// Run the actual TypeScript modules without a separate test dependency.
const modules = new Map();
function loadTs(filename) {
  if (modules.has(filename)) return modules.get(filename).exports;
  const module = { exports: {} };
  modules.set(filename, module);
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  new Function('require', 'module', 'exports', source)((id) => {
    if (!id.startsWith('.')) return require(id);
    const target = path.resolve(path.dirname(filename), id);
    return loadTs(fs.existsSync(target + '.ts') ? target + '.ts' : target + '.tsx');
  }, module, module.exports);
  return module.exports;
}
const root = path.resolve(__dirname, '..');
const { computeResults } = loadTs(path.join(root, 'src/lib/timing.ts'));
const { finishScanOrder } = loadTs(path.join(root, 'src/lib/liveRankings.ts'));
const { entrySequenceError } = loadTs(path.join(root, 'src/lib/entrySequence.ts'));
const race = {
  id: 'race', name: 'Test Race', date: '2026-10-26',
  checkpoints: [{ id: 'start', type: 'start', order: 0 }, { id: 'finish', type: 'finish', order: 1 }],
  distances: [{ id: '5', label: '5K', km: 5, price: 0 }, { id: '18', label: '18K', km: 18, price: 0 }],
  waveStartTimes: { '5K Solo': '2026-10-26T00:00:00Z', '5K Duo': '2026-10-26T00:10:00Z', '18K Solo': '2026-10-26T00:00:00Z' },
};
const time = (minutes) => new Date(Date.parse('2026-10-26T00:00:00Z') + minutes * 60_000).toISOString();
const runner = (bibNumber, entryCategory = 'solo', extra = {}) => ({
  uid: bibNumber, raceId: race.id, bibNumber, fullName: bibNumber === 'S' ? 'Michiron' : 'Michiron and Partner',
  distance: '5K', entryCategory, gender: 'male', age: 30, createdAt: time(0), ...extra,
});
const read = (bibNumber, checkpointId, minutes) => ({ bibNumber, checkpointId, timestamp: time(minutes) });
const solo = runner('S');
const duo = runner('D', 'duo', { startsAfterBib: 'S', teamMembers: ['Michiron', 'Partner'] });
const compute = (runners, reads) => computeResults(race.checkpoints, reads, runners, [], race);
const byBib = (results, bib) => results.find((result) => result.bibNumber === bib);

test('unlinked entries keep chip timing and division gun fallback', () => {
  const results = compute([solo, runner('U', 'duo')], [read('S', 'start', 1), read('S', 'finish', 31), read('U', 'finish', 40)]);
  assert.equal(byBib(results, 'S').finishTime, '00:30:00');
  assert.equal(byBib(results, 'S').timingMethod, 'chip');
  assert.equal(byBib(results, 'U').finishTime, '00:30:00');
  assert.equal(byBib(results, 'U').timingMethod, 'gun');
});

test('Solo finish starts the separate Duo bib, regardless of roster order or later chip start', () => {
  const results = compute([duo, solo], [read('S', 'finish', 30), read('D', 'start', 35), read('D', 'finish', 70)]);
  assert.equal(byBib(results, 'D').sequenceStartTime, time(30));
  assert.equal(byBib(results, 'D').finishTime, '00:40:00');
  assert.equal(byBib(results, 'D').chipTime, '00:35:00');
  assert.equal(byBib(results, 'D').gunTime, '01:00:00');
  assert.equal(byBib(results, 'D').timingMethod, 'transition');
  assert.equal(byBib(results, 'S').rank, 1);
  assert.equal(byBib(results, 'D').rank, 1);
});

test('next entry has a start and running clock before it finishes', () => {
  const results = compute([solo, duo], [read('S', 'finish', 30)]);
  assert.equal(byBib(results, 'D').sequenceStartTime, time(30));
  assert.equal(byBib(results, 'D').finishTime, undefined);
  assert.equal(byBib(results, 'D').rank, undefined);
});

test('next entry cannot finish before its predecessor or fall back to a wave', () => {
  const missingFinish = compute([solo, duo], [read('D', 'start', 10), read('D', 'finish', 20)]);
  assert.equal(byBib(missingFinish, 'D').rank, undefined);
  const tooEarly = compute([solo, duo], [read('S', 'finish', 30), read('D', 'finish', 20)]);
  assert.equal(byBib(tooEarly, 'D').finishTime, undefined);
  assert.equal(byBib(tooEarly, 'D').rank, undefined);
});

test('missing, invalid, or cyclic predecessors never produce official linked results', () => {
  assert.equal(byBib(compute([duo], [read('D', 'finish', 70)]), 'D').rank, undefined);
  const cycle = compute([{ ...solo, startsAfterBib: 'D' }, duo], [read('S', 'finish', 30), read('D', 'finish', 70)]);
  assert.ok(cycle.every((result) => result.rank === undefined));
  const invalid = compute([solo, duo], [read('S', 'finish', -10), read('D', 'finish', 70)]);
  assert.equal(byBib(invalid, 'D').rank, undefined);
});

test('three consecutive entries use the preceding finish and ignore duplicate later scans', () => {
  const third = runner('T', 'trio', { startsAfterBib: 'D' });
  const results = compute([third, duo, solo], [read('S', 'finish', 30), read('S', 'finish', 32), read('D', 'finish', 70), read('T', 'finish', 110)]);
  assert.equal(byBib(results, 'D').sequenceStartTime, time(30));
  assert.equal(byBib(results, 'T').sequenceStartTime, time(70));
  assert.equal(byBib(results, 'T').finishTime, '00:40:00');
});

test('removing a predecessor finish withdraws the downstream official result', () => {
  const results = compute([solo, duo], [read('D', 'finish', 70)]);
  assert.equal(byBib(results, 'D').finishTime, undefined);
  assert.equal(byBib(results, 'D').rank, undefined);
});

test('scan order spans distances and differs from elapsed-time order', () => {
  const other = runner('18', 'solo', { distance: '18K' });
  const results = compute([solo, duo, other], [read('S', 'finish', 30), read('D', 'finish', 70), read('18', 'start', 49), read('18', 'finish', 50)]);
  const rows = finishScanOrder(results, race);
  assert.deepEqual(rows.map((row) => row.result.bibNumber), ['S', '18', 'D']);
  assert.deepEqual(rows.map((row) => row.scanOrder), [1, 2, 3]);
  assert.equal(rows[2].result.rank, 1);
});

test('link validation rejects self-links, cycles, branching, unknown bibs, and shared chips', () => {
  assert.match(entrySequenceError([solo], 'S', 'S'), /itself/);
  assert.match(entrySequenceError([solo, duo], 'S', 'D'), /loop/);
  assert.match(entrySequenceError([solo, duo, runner('T')], 'T', 'S'), /already linked/);
  assert.match(entrySequenceError([solo], 'S', 'Missing'), /previous entry/);
  assert.match(entrySequenceError([runner('S', 'solo', { chipId: 'abc' }), runner('D', 'duo', { chipId: 'ABC' })], 'D', 'S'), /separate chips/);
  assert.equal(entrySequenceError([solo, duo], 'D', ''), undefined);
  assert.equal(entrySequenceError([solo, duo], 'D', 'S'), undefined);
});

test('live presentation renders navigation, official labels, and the linked-entry status', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const Screen = loadTs(path.join(root, 'src/components/LiveRankingsScreen.tsx')).default;
  const results = compute([solo, duo], [read('S', 'finish', 30)]);
  const html = renderToStaticMarkup(React.createElement(Screen, { race, results, onClose: () => {} }));
  assert.match(html, /aria-label="Live ranking views"/);
  assert.match(html, /Previous distance/);
  assert.match(html, /Next distance/);
  assert.match(html, /18K/);
  assert.match(html, /Scan # is arrival order/);
  assert.match(html, /Running/);
  assert.match(html, /5K Duo/);
  assert.match(html, /Michiron/);
});
