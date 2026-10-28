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
  assert.equal(byBib(results, 'S').finishTime, '00:30:00.000000');
  assert.equal(byBib(results, 'S').timingMethod, 'chip');
  assert.equal(byBib(results, 'U').finishTime, '00:30:00.000000');
  assert.equal(byBib(results, 'U').timingMethod, 'gun');
});

test('Solo finish starts the separate Duo bib, regardless of roster order or later chip start', () => {
  const results = compute([duo, solo], [read('S', 'finish', 30), read('D', 'start', 35), read('D', 'finish', 70)]);
  assert.equal(byBib(results, 'D').sequenceStartTime, time(30));
  assert.equal(byBib(results, 'D').finishTime, '00:40:00.000000');
  assert.equal(byBib(results, 'D').chipTime, '00:35:00.000000');
  assert.equal(byBib(results, 'D').gunTime, '01:00:00.000000');
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
  assert.equal(byBib(results, 'T').finishTime, '00:40:00.000000');
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

const preciseRead = (bibNumber, timestamp) => ({ bibNumber, checkpointId: 'finish', timestamp });
test('sub-millisecond finish order survives reversed bib and roster order', () => {
  const results = compute([runner('A'), runner('Z')], [preciseRead('A', '2026-10-26T00:30:00.123457Z'), preciseRead('Z', '2026-10-26T00:30:00.123456Z')]);
  assert.equal(results[0].bibNumber, 'Z');
  assert.equal(results[0].finishTime, '00:30:00.123456');
  assert.equal(results[0].rank, 1);
  assert.deepEqual(finishScanOrder(results, race).map(row => row.result.bibNumber), ['Z', 'A']);
});
test('seventh bridge fractional digit determines rank even when six display digits match', () => {
  const results = compute([runner('A'), runner('Z')], [preciseRead('A', '2026-10-26T00:30:00.1234569Z'), preciseRead('Z', '2026-10-26T00:30:00.1234561Z')]);
  assert.equal(results[0].bibNumber, 'Z');
  assert.equal(results[0].finishTime, results[1].finishTime);
  assert.ok(results[0].finishSeconds < results[1].finishSeconds);
});
test('identical measurements share provisional division and age places', () => {
  const runners = [runner('A'), runner('Z'), runner('C')];
  const results = computeResults(race.checkpoints, [preciseRead('A', time(30)), preciseRead('Z', time(30)), preciseRead('C', time(31))], runners, [{id:'age', gender:'male', minAge:18, maxAge:40, label:'Adult'}], race);
  assert.deepEqual(results.map(r => r.rank), [1, 1, 3]);
  assert.deepEqual(results.map(r => r.categoryRank), [1, 1, 3]);
  assert.ok(results[0].finishReviewRequired && results[1].finishReviewRequired);
  assert.equal(results[2].finishReviewRequired, undefined);
});
test('configured uncertainty window flags close places without changing measured order', () => {
  const results = computeResults(race.checkpoints, [preciseRead('A', '2026-10-26T00:30:00.100Z'), preciseRead('Z', '2026-10-26T00:30:00.105Z')], [runner('A'), runner('Z')], [], {...race, finishReviewWindowMs:10});
  assert.deepEqual(results.map(r => r.rank), [1,2]);
  assert.ok(results.every(r => r.finishReviewRequired));
});
test('earliest precise duplicate wins and invalid timestamps cannot hide valid reads', () => {
  const results = compute([runner('A')], [preciseRead('A', 'invalid'), preciseRead('A', '2026-10-26T00:30:00.1234569Z'), preciseRead('A', '2026-10-26T00:30:00.1234559Z')]);
  assert.equal(results[0].finishTime, '00:30:00.123455');
});
test('offset timestamps, midnight rollover and fractional start retain precision', () => {
  const {elapsedSeconds, formatElapsed} = loadTs(path.join(root, 'src/lib/preciseTime.ts'));
  assert.equal(formatElapsed(elapsedSeconds('2026-10-26T23:59:59.999999+08:00', '2026-10-26T16:00:00.000001Z')), '00:00:00.000002');
  assert.equal(formatElapsed(59.9999999), '00:00:59.999999');
  assert.equal(formatElapsed(60), '00:01:00.000000');
  assert.equal(elapsedSeconds(time(30), time(0)), undefined);
});
