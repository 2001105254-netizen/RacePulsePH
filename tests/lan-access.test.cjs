const {test}=require('node:test'),assert=require('node:assert/strict');
const {authorize,visible}=require('../functions/lan-policy');
const operator={uid:'operator',permissions:{'timing.scan':true,'timing.view':true},scope:'selected',allowedRaceIds:['race_a']};
test('LAN rejects anonymous writes and forged operator identity',()=>{
 assert.equal(authorize(null,'POST','/api/chip-reads',{}),false);
 assert.equal(authorize(operator,'POST','/api/chip-reads',{raceId:'race_a',recordedBy:'other'}),false);
 assert.equal(authorize(operator,'POST','/api/chip-reads',{raceId:'race_a',recordedBy:'operator'}),true);
 assert.equal(authorize(operator,'POST','/api/chip-reads',{raceId:'race_b',recordedBy:'operator'}),false);
});
test('LAN private reads are scoped and runner engraving access is owner-only',()=>{
 assert.equal(visible(operator,'chipReads',{raceId:'race_b'}),false);
 const runner={uid:'runner',permissions:{'personal.engraving':true}};
 assert.equal(visible(runner,'orders',{ownerUid:'runner'}),true);assert.equal(visible(runner,'orders',{ownerUid:'other'}),false);
 assert.equal(authorize(runner,'POST','/api/orders',{status:'completed',ownerUid:'runner'}),false);
});
test('LAN reset requires protected authority and corrections cannot change read identity',()=>{
 assert.equal(authorize(operator,'POST','/api/chip-reads/reset',{}),false);
 assert.equal(authorize({...operator,authority:true},'POST','/api/chip-reads/reset',{}),false);
 assert.equal(authorize({...operator,authority:true,scope:'all'},'POST','/api/chip-reads/reset',{}),true);
 assert.equal(authorize({...operator,authority:true},'DELETE','/api/chip-reads/other',{}, {raceId:'race_b'}),false);
 assert.equal(authorize(operator,'POST','/api/chip-reads',{raceId:'race_a',recordedBy:'operator',bibNumber:'new'},{raceId:'race_a',recordedBy:'operator',bibNumber:'old'}),false);
 assert.equal(authorize({...operator,permissions:{...operator.permissions,'engraving.status':true}},'POST','/api/orders',{id:'ord1',status:'invalid_status'},{id:'ord1',status:'queued'}),false);
});
test('LAN blocks trailing-slash reset bypasses and unexpected subroutes',()=>{
 assert.equal(authorize({...operator,permissions:{...operator.permissions,'engraving.create':true}},'POST','/api/orders/reset/',{status:'queued'}),false);
 assert.equal(authorize(operator,'POST','/api/chip-reads/reset/',{raceId:'race_a',recordedBy:'operator'}),false);
 assert.equal(authorize({...operator,authority:true,scope:'all'},'POST','/api/orders/reset/',{}),true);
 assert.equal(authorize(operator,'POST','/api/orders/unexpected',{status:'queued'}),false);
});
test('LAN blocks bridge metadata tampering on existing chipReads', () => {
 const existing = {
  id: 'r1',
  raceId: 'race_a',
  recordedBy: 'operator',
  bibNumber: '5-001',
  chipId: 'E200',
  checkpointId: 'finish',
  timestamp: '2026-10-26T00:10:00Z',
  source: 'rfid-bridge',
  bridgeEventId: 'evt_1',
  antenna: 1,
  readerSequence: 10,
  monotonicTicks: '1000',
  monotonicFrequency: '10000000',
  clockSource: 'bridge-receipt',
 };
 assert.equal(authorize(operator, 'POST', '/api/chip-reads', { ...existing }, existing), true);
 assert.equal(authorize(operator, 'POST', '/api/chip-reads', { ...existing, antenna: 2 }, existing), false);
 assert.equal(authorize(operator, 'POST', '/api/chip-reads', { ...existing, readerSequence: 11 }, existing), false);
 assert.equal(authorize(operator, 'POST', '/api/chip-reads', { ...existing, bridgeEventId: 'evt_2' }, existing), false);
 assert.equal(authorize(operator, 'POST', '/api/chip-reads', { ...existing, monotonicTicks: '9999' }, existing), false);
 assert.equal(authorize(operator, 'POST', '/api/chip-reads', { ...existing, clockSource: 'forged' }, existing), false);
});

test('LAN enforces default-deny and explicit read permissions for GET routes', () => {
 assert.equal(authorize(operator, 'GET', '/api/unknown', {}), false);
 assert.equal(authorize(operator, 'GET', '/api/orders', {}), false);
 assert.equal(authorize(operator, 'GET', '/api/chip-reads', {}), true);
 const runner = { uid: 'runner', permissions: { 'personal.engraving': true } };
 assert.equal(authorize(runner, 'GET', '/api/orders', {}), true);
 assert.equal(authorize(runner, 'GET', '/api/chip-reads', {}), false);
});
