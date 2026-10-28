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
});
