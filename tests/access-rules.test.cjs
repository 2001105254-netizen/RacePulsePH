const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const policy = require('../functions/access-policy');
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { doc, setDoc, getDoc, updateDoc, deleteDoc, collection, query, where, getDocs } = require('firebase/firestore');
let env;
before(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-racepulse-rbac', firestore: { host: '127.0.0.1', port: 8080, rules: fs.readFileSync('firestore.rules','utf8') } });
  await env.withSecurityRulesDisabled(async ctx => {
    const db=ctx.firestore();
    for(const role of ['runner','organizer','admin','superadmin']) {
      const user={uid:role,role,approved:true,email:`${role}@example.com`,displayName:role,createdAt:'2026-01-01'};
      await setDoc(doc(db,'users',role),user);
      const state=policy.accessFor(user);state.permissions=Object.fromEntries(policy.keys.map(key=>[key,policy.can(user,state,key)]));
      await setDoc(doc(db,'userAccess',role),state);
    }
    await setDoc(doc(db,'users','pending'),{uid:'pending',role:'organizer',approved:false});
    for(const [id,createdBy] of [['race_a','organizer'],['race_b','other']])await setDoc(doc(db,'races',id),{id,createdBy,createdAt:'2026-01-01',name:id,date:'2026-12-01',registrationOpen:true,checkpoints:[],distances:[]});
    await setDoc(doc(db,'runners','runner_race_a'),{uid:'runner',raceId:'race_a',fullName:'Runner',bibNumber:'5-001',distance:'5K',gender:'male',age:25,createdAt:'2026-01-01'});
    await setDoc(doc(db,'orders','mine'),{ownerUid:'runner',runnerName:'Runner',bibNumber:'5-001',distance:'5K',finishingTime:'00:20:00',status:'queued',createdAt:'2026-01-01',updatedAt:'2026-01-01'});
    await setDoc(doc(db,'orders','other'),{ownerUid:'other',runnerName:'Other',bibNumber:'5-002',distance:'5K',finishingTime:'00:20:00',status:'queued',createdAt:'2026-01-01',updatedAt:'2026-01-01'});
  });
});
after(async()=>env?.cleanup());
const db=uid=>env.authenticatedContext(uid,{email:`${uid}@example.com`,email_verified:true}).firestore();
test('public event browsing remains available',async()=>assertSucceeds(getDoc(doc(env.unauthenticatedContext().firestore(),'races','race_a'))));
test('runner cannot promote self or forge an access record',async()=>{
 await assertFails(updateDoc(doc(db('runner'),'users','runner'),{role:'superadmin'}));
 await assertFails(setDoc(doc(db('runner'),'userAccess','runner'),{overrides:{'race.create':true}}));
 await assertFails(setDoc(doc(db('superadmin'),'accessHistory','forged'),{actorUid:'superadmin'}));
 await assertFails(updateDoc(doc(db('superadmin'),'users','runner'),{role:'admin'}));
});
test('organizer scope protects private roster and race updates',async()=>{
 await assertSucceeds(getDocs(query(collection(db('organizer'),'runners'),where('raceId','==','race_a'))));
 await assertFails(getDocs(query(collection(db('organizer'),'runners'),where('raceId','==','race_b'))));
 await assertSucceeds(updateDoc(doc(db('organizer'),'races','race_a'),{name:'Updated'}));
 await assertFails(updateDoc(doc(db('organizer'),'races','race_b'),{name:'Forbidden'}));
});
test('explicit admin denial and selected-race scope override broad role defaults',async()=>{
 const user={uid:'admin',role:'admin',approved:true},state={status:'active',scope:'selected',raceIds:['race_a'],overrides:{'race.edit':false}};
 await env.withSecurityRulesDisabled(ctx=>setDoc(doc(ctx.firestore(),'userAccess','admin'),{...state,permissions:Object.fromEntries(policy.keys.map(key=>[key,policy.can(user,state,key)]))}));
 await assertFails(updateDoc(doc(db('admin'),'races','race_a'),{name:'Denied'}));
 await assertFails(updateDoc(doc(db('admin'),'races','race_b'),{date:'2027-01-01'}));
 await assertSucceeds(updateDoc(doc(db('admin'),'races','race_a'),{registrationOpen:false}));
});
test('runner can track own engraving but cannot read global queue or change status',async()=>{
 await assertSucceeds(getDoc(doc(db('runner'),'orders','mine')));
 await assertFails(getDoc(doc(db('runner'),'orders','other')));
 await assertFails(getDocs(collection(db('runner'),'orders')));
 await assertFails(updateDoc(doc(db('runner'),'orders','mine'),{status:'completed'}));
});
test('runner cannot claim kits or assign a chip through a profile edit',async()=>{
 await assertFails(updateDoc(doc(db('runner'),'runners','runner_race_a'),{kitClaimedAt:'2026-10-28'}));
 await assertFails(updateDoc(doc(db('runner'),'runners','runner_race_a'),{chipId:'DEADBEEF'}));
});
test('normal multi-field race setup and roster operations remain functional',async()=>{
 await assertSucceeds(updateDoc(doc(db('organizer'),'races','race_a'),{name:'Race setup',date:'2026-12-02',checkpoints:[{id:'start',type:'start',label:'Start',order:0}],distances:[{id:'5K',label:'5K',km:5,price:0}],registrationOpen:true,posterImage:'https://example.com/poster.png',raceBibTemplateImage:'https://example.com/bib.png',manualPaymentEnabled:false}));
 await assertSucceeds(updateDoc(doc(db('organizer'),'runners','runner_race_a'),{chipId:'DEADBEEF'}));
 await assertSucceeds(updateDoc(doc(db('organizer'),'runners','runner_race_a'),{kitClaimedAt:'2026-10-28'}));
});
test('new verified runner can complete the profile and read its personal registration',async()=>{
 const fresh=env.authenticatedContext('new_runner',{email:'new@example.com',email_verified:true}).firestore();
 await assertSucceeds(setDoc(doc(fresh,'users','new_runner'),{uid:'new_runner',email:'new@example.com',displayName:'New runner',role:'runner',approved:true,createdAt:'2026-10-28'}));
 await env.withSecurityRulesDisabled(async ctx => { const user={uid:'new_runner',role:'runner',approved:true}; const access=policy.accessFor(user); access.permissions=Object.fromEntries(policy.keys.map(key=>[key,policy.can(user,access,key)])); await setDoc(doc(ctx.firestore(),'userAccess','new_runner'),access); });
 await assertSucceeds(setDoc(doc(fresh,'runners','new_runner_race_a'),{uid:'new_runner',raceId:'race_a',fullName:'New Runner',bibNumber:'5-003',distance:'5K',gender:'female',age:25,createdAt:'2026-10-28'}));
 await assertSucceeds(getDoc(doc(fresh,'runners','new_runner_race_a')));
 await assertFails(setDoc(doc(env.authenticatedContext('forged_admin',{email:'evil@example.com',email_verified:true}).firestore(),'users','forged_admin'),{uid:'forged_admin',email:'evil@example.com',displayName:'Evil',role:'admin',approved:true,createdAt:'2026-10-28'}));
});
test('pending organizer cannot operate races',async()=>assertFails(setDoc(doc(db('pending'),'races','pending_race'),{id:'pending_race',createdBy:'pending',createdAt:'2026-01-01',name:'Pending'})));
test('timing identity, scope and completed-race lock cannot be forged',async()=>{
 const read={raceId:'race_a',bibNumber:'5-001',checkpointId:'start',timestamp:'2026-10-28T00:00:00Z',source:'manual',recordedBy:'organizer',createdAt:'2026-10-28T00:00:00Z'};
 await assertSucceeds(setDoc(doc(db('organizer'),'chipReads','valid'),read));
 await assertFails(setDoc(doc(db('organizer'),'chipReads','forged'),{...read,recordedBy:'admin'}));
 await assertFails(setDoc(doc(db('organizer'),'chipReads','wrong_race'),{...read,raceId:'race_b'}));
 await env.withSecurityRulesDisabled(ctx=>updateDoc(doc(ctx.firestore(),'races','race_a'),{completedAt:'2026-10-28T01:00:00Z'}));
 await assertFails(setDoc(doc(db('organizer'),'chipReads','late'),read));
});
test('suspension blocks operational access even for Super Admin',async()=>{
 await env.withSecurityRulesDisabled(ctx=>setDoc(doc(ctx.firestore(),'userAccess','superadmin'),{status:'suspended',scope:'all',raceIds:[],overrides:{}}));
 await assertFails(deleteDoc(doc(db('superadmin'),'races','race_b')));
 await assertSucceeds(getDoc(doc(db('superadmin'),'users','superadmin')));
});
test('selected-race restriction also applies to protected race deletion',async()=>{
 const user={uid:'superadmin',role:'superadmin',approved:true},state={status:'active',scope:'selected',raceIds:['race_a'],overrides:{}};
 await env.withSecurityRulesDisabled(ctx=>setDoc(doc(ctx.firestore(),'userAccess','superadmin'),{...state,permissions:Object.fromEntries(policy.keys.map(key=>[key,policy.can(user,state,key)]))}));
 await assertFails(deleteDoc(doc(db('superadmin'),'races','race_b')));
});
