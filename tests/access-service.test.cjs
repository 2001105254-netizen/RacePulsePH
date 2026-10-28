const {test,before,after}=require('node:test'),assert=require('node:assert/strict');
const admin=require('../functions/node_modules/firebase-admin');
const {createAccessService}=require('../functions/access-service');
let app,db,service;
before(async()=>{
 if(!process.env.FIRESTORE_EMULATOR_HOST)throw Error('Service integration tests require the emulator.');
 app=admin.initializeApp({projectId:'demo-racepulse-rbac'},'access-tests');db=app.firestore();service=createAccessService(db);
 for(const [uid,role]of [['svc_owner','superadmin'],['svc_other','superadmin'],['svc_runner','runner']])await db.doc(`users/${uid}`).set({uid,role,approved:true,displayName:uid});
 await db.doc('accessSystem/rollout').set({enforcementReady:true});await db.doc('accessSystem/authority').set({members:['svc_owner','svc_other']});
});
after(async()=>app?.delete());
const input=()=>({uid:'svc_runner',role:'runner',status:'active',scope:'owned-assigned',raceIds:[],overrides:{},revision:0,requestId:crypto.randomUUID()});
test('ordinary accounts cannot call privileged commands',async()=>assert.rejects(service.execute('svc_runner','/save',input()),/Super Admin/));
test('transaction writes one audit event, duplicate retries are idempotent and stale edits conflict',async()=>{
 const payload=input();await service.execute('svc_owner','/save',payload);await service.execute('svc_owner','/save',payload);
 assert.equal((await db.doc('userAccess/svc_runner').get()).data().revision,1);
 const history=await service.execute('svc_owner','/history',{uid:'svc_runner'});assert.equal(history.history.length,1);
 await assert.rejects(service.execute('svc_owner','/save',{...input(),requestId:crypto.randomUUID()}),/Access changed/);
 await assert.rejects(service.execute('svc_owner','/save',{...payload,status:'suspended'}),/Request ID/);
});
test('self-demotion is rejected and concurrent edits cannot both win',async()=>{
 await assert.rejects(service.execute('svc_owner','/save',{...input(),uid:'svc_owner',role:'admin'}),/own Super Admin/);
 const results=await Promise.allSettled([service.execute('svc_owner','/save',{...input(),revision:1}),service.execute('svc_other','/save',{...input(),revision:1,status:'suspended'})]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
});
test('restore creates a new revision and new history instead of deleting history',async()=>{
 const state=(await db.doc('userAccess/svc_runner').get()).data();
 const history=await service.execute('svc_owner','/history',{uid:'svc_runner'});
 await service.execute('svc_owner','/restore',{uid:'svc_runner',historyId:history.history.at(-1).id,revision:state.revision,requestId:crypto.randomUUID()});
 assert.equal((await db.doc('userAccess/svc_runner').get()).data().revision,state.revision+1);
});
test('revoked authority cannot read history or mutate another account',async()=>{
 await db.doc('userAccess/svc_other').set({status:'suspended'});
 await assert.rejects(service.execute('svc_other','/history',{uid:'svc_runner'}),/suspended/);
});
test('app removal suspends access and audited restoration can reactivate the account',async()=>{
 const state=(await db.doc('userAccess/svc_runner').get()).data();
 const history=await service.execute('svc_owner','/history',{uid:'svc_runner'});
 const active=history.history.find(row=>row.after.access.status==='active');
 await service.execute('svc_owner','/remove',{uid:'svc_runner',revision:state.revision,requestId:crypto.randomUUID()});
 assert.equal((await db.doc('users/svc_runner').get()).data().accessRemoved,true);
 await assert.rejects(service.execute('svc_runner','/session',{}),/suspended/);
 await service.execute('svc_owner','/restore',{uid:'svc_runner',revision:state.revision+1,historyId:active.id,requestId:crypto.randomUUID()});
 assert.equal((await db.doc('users/svc_runner').get()).data().accessRemoved,false);
 assert.equal((await db.doc('removedAccounts/svc_runner').get()).exists,false);
});
test('the authority registry cannot lose its last active member',async()=>{
 await db.doc('userAccess/svc_other').set({status:'active'});
 await db.doc('accessSystem/authority').set({members:['svc_other']});
 await assert.rejects(service.execute('svc_owner','/save',{...input(),uid:'svc_other',role:'admin'}),/At least one/);
});
