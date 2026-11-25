const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const policy = require('../functions/access-policy');
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { doc, setDoc, getDoc, updateDoc, deleteDoc, collection, query, where, orderBy, getDocs, runTransaction } = require('firebase/firestore');
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
test('Super Admin remains global after a legacy selected-race scope',async()=>{
 const user={uid:'superadmin',role:'superadmin',approved:true},state={status:'active',scope:'selected',raceIds:['race_a'],overrides:{}};
 await env.withSecurityRulesDisabled(ctx=>setDoc(doc(ctx.firestore(),'userAccess','superadmin'),{...state,permissions:Object.fromEntries(policy.keys.map(key=>[key,policy.can(user,state,key)]))}));
 await assertSucceeds(updateDoc(doc(db('superadmin'),'races','race_b'),{name:'Super Admin update'}));
});

test('finish review window requires correction permission and a bounded numeric value', async()=>{
 await assertFails(updateDoc(doc(db('organizer'),'races','race_a'),{finishReviewWindowMs:10}));
 await assertSucceeds(updateDoc(doc(db('admin'),'races','race_a'),{finishReviewWindowMs:10}));
 await assertFails(updateDoc(doc(db('admin'),'races','race_a'),{finishReviewWindowMs:-1}));
 await assertFails(updateDoc(doc(db('admin'),'races','race_a'),{finishReviewWindowMs:60001}));
 await assertFails(updateDoc(doc(db('admin'),'races','race_a'),{finishReviewWindowMs:'10'}));
});

test('disqualifiedBibs requires timing permission, race scope, and a map', async()=>{
 await assertSucceeds(updateDoc(doc(db('organizer'),'races','race_a'),{disqualifiedBibs:{'5-001':'Missed checkpoint'}}));
 await assertSucceeds(updateDoc(doc(db('admin'),'races','race_a'),{disqualifiedBibs:{}}));
 await assertFails(updateDoc(doc(db('organizer'),'races','race_b'),{disqualifiedBibs:{'5-001':'Out of scope'}}));
 await assertFails(updateDoc(doc(db('runner'),'races','race_a'),{disqualifiedBibs:{'5-001':'Forbidden'}}));
 await assertFails(updateDoc(doc(db('admin'),'races','race_a'),{disqualifiedBibs:['5-001']}));
});

test('runnerHighlights and system/highlightsConfig enforce Highlights RBAC permissions', async()=>{
 const validHighlight={id:'hl_1',mode:'solo',runnerName:'Marco Reyes',bibNumber:'21-01',placement:'1st',distance:'21K',chipTime:'01:24:18',pace:'3:59 /km',raceName:'Manila Half',raceDate:'2026-11-10',photoUrl:'data:image/jpeg;base64,abc',borderPreset:'liquid-gold',cornerGeometry:'rounded',accentColor:'#f5b731',glowIntensity:75,surfaceFinish:'glossy',createdAt:'2026-11-10T00:00:00Z',updatedAt:'2026-11-10T00:00:00Z'};
 await assertSucceeds(setDoc(doc(db('admin'),'runnerHighlights','hl_1'),validHighlight));
 await assertSucceeds(setDoc(doc(db('admin'),'runnerHighlights','hl_group'),{
  ...validHighlight,
  id:'hl_group',
  mode:'group',
  teamName:'Sugakod Relay',
  groupPhotoLayout:'collage',
  groupMembers:[{name:'Ana',bibNumber:'101',photoUrl:'data:image/jpeg;base64,a'},{name:'Ben',bibNumber:'102',photoUrl:'data:image/jpeg;base64,b'}],
 }));
 await assertFails(setDoc(doc(db('admin'),'runnerHighlights','hl_bad_group'),{
  ...validHighlight,
  id:'hl_bad_group',
  mode:'group',
  groupPhotoLayout:'invalid',
 }));
 await assertSucceeds(getDoc(doc(env.unauthenticatedContext().firestore(),'runnerHighlights','hl_1')));
 await assertFails(setDoc(doc(db('organizer'),'runnerHighlights','hl_org'),{...validHighlight,id:'hl_org'}));
 await assertFails(setDoc(doc(db('runner'),'runnerHighlights','hl_run'),{...validHighlight,id:'hl_run'}));

 // Admin without highlights.playlist can update marquee physics/settings, but not smart playlist rules
 await assertSucceeds(setDoc(doc(db('admin'),'system','highlightsConfig'),{speedPxPerSec:52,hoverBehavior:'slow',direction:'left',layoutMode:'card',cardGapPx:20,edgeFadePx:48},{merge:true}));
 await assertFails(setDoc(doc(db('admin'),'system','highlightsConfig'),{pinPodiumFirst:false},{merge:true}));
 await assertSucceeds(setDoc(doc(db('superadmin'),'system','highlightsConfig'),{pinPodiumFirst:false,filterRaceId:'latest',hideExpired:true},{merge:true}));

 // Legacy Admin userAccess omitting highlights.* keys still resolves Admin preset defaults
 await env.withSecurityRulesDisabled(async ctx=>{
  const root=ctx.firestore();
  await setDoc(doc(root,'userAccess','admin'),{status:'active',scope:'all',raceIds:[],overrides:{},permissions:{'race.view':true}});
  await setDoc(doc(root,'users','admin_no_access'),{uid:'admin_no_access',role:'admin',approved:true,email:'legacy@example.com',displayName:'Legacy Admin',createdAt:'2026-01-01'});
 });
 await assertSucceeds(setDoc(doc(db('admin'),'runnerHighlights','hl_legacy'),{...validHighlight,id:'hl_legacy',photoUrl:'data:image/jpeg;base64,'+'a'.repeat(550000)}));
 await assertSucceeds(setDoc(doc(db('admin'),'system','highlightsConfig'),{speedPxPerSec:64},{merge:true}));
 await assertFails(setDoc(doc(db('admin'),'system','highlightsConfig'),{pinPodiumFirst:true},{merge:true}));
 await assertSucceeds(setDoc(doc(db('admin_no_access'),'runnerHighlights','hl_no_acc'),{...validHighlight,id:'hl_no_acc'}));

 // Explicit overrides deny highlights.manage even when permissions omits highlights.*
 await env.withSecurityRulesDisabled(ctx=>setDoc(doc(ctx.firestore(),'userAccess','admin'),{status:'active',scope:'all',raceIds:[],overrides:{'highlights.manage':false},permissions:{'race.view':true}}));
 await assertFails(setDoc(doc(db('admin'),'runnerHighlights','hl_denied'),{...validHighlight,id:'hl_denied'}));
 await env.withSecurityRulesDisabled(ctx=>setDoc(doc(ctx.firestore(),'userAccess','admin'),{status:'active',scope:'all',raceIds:[],overrides:{'highlights.view':false},permissions:{'race.view':true}}));
 await assertFails(setDoc(doc(db('admin'),'runnerHighlights','hl_view_denied'),{...validHighlight,id:'hl_view_denied'}));
 await assertFails(setDoc(doc(db('superadmin'),'runnerHighlights','hl_xss_photo'),{...validHighlight,id:'hl_xss_photo',photoUrl:'data:image/svg+xml;base64,PHN2Zz4='}));
});
test('friendDirectory prevents hijacking another UID handle and runner rules block paid self-registration bypass',async()=>{
 await env.withSecurityRulesDisabled(async ctx=>{
  const root=ctx.firestore();
  await setDoc(doc(root,'users','alice'),{uid:'alice',role:'runner',approved:false,email:'alice@example.com',displayName:'Alice',createdAt:'2026-01-01'});
  await setDoc(doc(root,'usernameIndex','alice'),{username:'alice',uid:'alice',email:'alice@example.com',createdAt:'2026-01-01'});
  await setDoc(doc(root,'friendDirectory','alice'),{uid:'alice',username:'alice',displayName:'Alice'});
  await setDoc(doc(root,'races','paid_race'),{id:'paid_race',name:'Paid Run',createdBy:'organizer',status:'published',distances:[{label:'10K',km:10,price:500}]});
 });
 await assertFails(setDoc(doc(env.authenticatedContext('runner',{email_verified:true}).firestore(),'friendDirectory','alice'),{uid:'runner',username:'alice',displayName:'Hijacked'}));
 await assertFails(setDoc(doc(env.authenticatedContext('runner',{email_verified:true}).firestore(),'runners','runner_paid_race'),{uid:'runner',raceId:'paid_race',distance:'10K',bibNumber:'10-001',paymentStatus:'paid',registeredAt:'2026-01-01'}));
 await assertFails(setDoc(doc(env.authenticatedContext('runner',{email_verified:true}).firestore(),'bibCounters','paid_race_10K'),{raceId:'paid_race',count:250}));
});

test('routePresets, immutable versions, and publishedRaceRoutes enforce owner scope and public/private isolation', async () => {
 await assertSucceeds(setDoc(doc(db('organizer'), 'routePresets', 'preset_1'), { id: 'preset_1', ownerUid: 'organizer', title: 'Course 1', archived: false }));
 await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'routePresets', 'preset_1')));
 await assertFails(getDoc(doc(db('runner'), 'routePresets', 'preset_1')));
 await assertSucceeds(setDoc(doc(db('organizer'), 'routePresets', 'preset_1', 'versions', 'v1'), { id: 'v1', presetId: 'preset_1', versionNumber: 1 }));
 await assertFails(updateDoc(doc(db('organizer'), 'routePresets', 'preset_1', 'versions', 'v1'), { versionNumber: 2 }));
 await assertSucceeds(setDoc(doc(db('organizer'), 'publishedRaceRoutes', 'pub_1'), { id: 'pub_1', status: 'published', raceId: 'race_a' }));
 await assertSucceeds(getDoc(doc(env.unauthenticatedContext().firestore(), 'publishedRaceRoutes', 'pub_1')));
});

test('superadmin bootstrap and system/meta claims allow owner repeatedly and reject non-owners', async () => {
  const ownerUid = 'kiahzeh_uid';
  const ownerEmail = 'kiahzeh@gmail.com';
  const ownerDb = env.authenticatedContext(ownerUid, { email: ownerEmail, email_verified: true }).firestore();
  const runnerDb = db('runner');

  await assertFails(setDoc(doc(runnerDb, 'system', 'meta'), { superAdminClaimed: true }));
  await assertFails(setDoc(doc(runnerDb, 'users', 'fake_admin'), {
    uid: 'fake_admin',
    email: 'fake@example.com',
    displayName: 'Fake Admin',
    role: 'superadmin',
    approved: true,
    createdAt: '2026-01-01',
  }));

  await assertSucceeds(setDoc(doc(ownerDb, 'system', 'meta'), { superAdminClaimed: true }, { merge: true }));
  await assertSucceeds(setDoc(doc(ownerDb, 'system', 'meta'), { superAdminClaimed: true }, { merge: true }));

  await assertSucceeds(setDoc(doc(ownerDb, 'users', ownerUid), {
    uid: ownerUid,
    email: ownerEmail,
    displayName: 'Platform Owner',
    role: 'superadmin',
    approved: true,
    createdAt: '2026-01-01',
  }));
});

test('bibClaimLocks is strictly backend-only and usernameIndex blocks unauthenticated/cross-user reads while allowing uniqueness checks', async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const root = ctx.firestore();
    await setDoc(doc(root, 'bibClaimLocks', 'race_a_5-001'), { uid: 'runner', raceId: 'race_a', bibNumber: '5-001' });
    await setDoc(doc(root, 'usernameIndex', 'runner_handle'), { username: 'runner_handle', uid: 'runner', email: 'runner@example.com', createdAt: '2026-01-01' });
  });

  await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'bibClaimLocks', 'race_a_5-001')));
  await assertFails(getDoc(doc(db('superadmin'), 'bibClaimLocks', 'race_a_5-001')));
  await assertFails(setDoc(doc(db('superadmin'), 'bibClaimLocks', 'race_a_5-999'), { uid: 'runner', raceId: 'race_a', bibNumber: '5-999' }));

  await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'usernameIndex', 'alice')));
  await assertFails(getDocs(collection(db('superadmin'), 'usernameIndex')));
  await assertSucceeds(getDoc(doc(db('runner'), 'usernameIndex', 'available_handle_99')));
  await assertSucceeds(getDoc(doc(db('runner'), 'usernameIndex', 'runner_handle')));
  await assertFails(getDoc(doc(db('runner'), 'usernameIndex', 'alice')));
  await assertSucceeds(getDoc(doc(db('superadmin'), 'usernameIndex', 'alice')));
});

test('publishedRaceRoutes, raceRouteCatalog, routeJobs, and routeAudit enforce race scope and server-only activity writes', async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const root = ctx.firestore();
    await setDoc(doc(root, 'publishedRaceRoutes', 'pub_private_a'), { id: 'pub_private_a', status: 'withdrawn', raceId: 'race_a' });
    await setDoc(doc(root, 'publishedRaceRoutes', 'pub_private_b'), { id: 'pub_private_b', status: 'superseded', raceId: 'race_b' });
    await setDoc(doc(root, 'raceRouteCatalog', 'race_b_10k'), { id: 'race_b_10k', status: 'published', raceId: 'race_b' });
    await setDoc(doc(root, 'routeJobs', 'job_a'), { id: 'job_a', raceId: 'race_a', ownerUid: 'organizer', status: 'queued' });
    await setDoc(doc(root, 'routeJobs', 'job_b'), { id: 'job_b', raceId: 'race_b', ownerUid: 'other', status: 'queued' });
    await setDoc(doc(root, 'routeAudit', 'audit_a'), { id: 'audit_a', raceId: 'race_a', actorUid: 'organizer', action: 'publish' });
    await setDoc(doc(root, 'routeAudit', 'audit_preset'), { id: 'audit_preset', presetId: 'preset_1', actorUid: 'other', action: 'edit' });
    await setDoc(doc(root, 'routeAudit', 'audit_b'), { id: 'audit_b', raceId: 'race_b', actorUid: 'other', action: 'publish' });
  });

  await assertFails(setDoc(doc(db('organizer'), 'publishedRaceRoutes', 'pub_wrong'), { id: 'pub_wrong', status: 'published', raceId: 'race_b' }));
  await assertFails(updateDoc(doc(db('organizer'), 'publishedRaceRoutes', 'pub_1'), { raceId: 'race_b' }));
  await assertSucceeds(setDoc(doc(db('organizer'), 'raceRouteCatalog', 'race_a_5k'), { id: 'race_a_5k', status: 'published', raceId: 'race_a' }));
  await assertFails(setDoc(doc(db('organizer'), 'raceRouteCatalog', 'race_b_5k'), { id: 'race_b_5k', status: 'published', raceId: 'race_b' }));
  await assertFails(updateDoc(doc(db('organizer'), 'raceRouteCatalog', 'race_b_10k'), { raceId: 'race_a' }));

  await assertSucceeds(getDoc(doc(db('organizer'), 'publishedRaceRoutes', 'pub_private_a')));
  await assertFails(getDoc(doc(db('organizer'), 'publishedRaceRoutes', 'pub_private_b')));
  await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'publishedRaceRoutes', 'pub_private_a')));

  await assertSucceeds(getDoc(doc(db('organizer'), 'routeJobs', 'job_a')));
  await assertFails(getDoc(doc(db('organizer'), 'routeJobs', 'job_b')));
  await assertSucceeds(getDoc(doc(db('organizer'), 'routeAudit', 'audit_a')));
  await assertSucceeds(getDoc(doc(db('organizer'), 'routeAudit', 'audit_preset')));
  await assertFails(getDoc(doc(db('organizer'), 'routeAudit', 'audit_b')));
  await assertSucceeds(getDoc(doc(db('superadmin'), 'routeAudit', 'audit_b')));
  await assertFails(getDoc(doc(db('runner'), 'routeAudit', 'audit_a')));

  await assertFails(setDoc(doc(db('organizer'), 'routeJobs', 'job_client'), { id: 'job_client', raceId: 'race_a', ownerUid: 'organizer' }));
  await assertFails(setDoc(doc(db('superadmin'), 'routeJobs', 'job_sa'), { id: 'job_sa', raceId: 'race_a', ownerUid: 'superadmin' }));
  await assertFails(setDoc(doc(db('organizer'), 'routeAudit', 'audit_client'), { id: 'audit_client', raceId: 'race_a', actorUid: 'organizer' }));
  await assertFails(setDoc(doc(db('superadmin'), 'routeAudit', 'audit_sa'), { id: 'audit_sa', raceId: 'race_a', actorUid: 'superadmin' }));
});

test('runner self-updates lock demographics after timing start or kit/chip assignment while allowing emergency/shirt edits', async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const root = ctx.firestore();
    await setDoc(doc(root, 'races', 'race_lock_test'), {
      id: 'race_lock_test',
      createdBy: 'organizer',
      createdAt: '2026-01-01',
      name: 'Lock Test',
      date: '2026-12-01',
      registrationOpen: true,
      checkpoints: [],
      distances: [{ id: '5K', label: '5K', km: 5, price: 0 }, { id: '10K', label: '10K', km: 10, price: 0 }],
    });
    await setDoc(doc(root, 'runners', 'runner_race_lock_test'), {
      uid: 'runner',
      raceId: 'race_lock_test',
      fullName: 'Runner Initial',
      bibNumber: '5-001',
      distance: '5K',
      gender: 'male',
      age: 25,
      createdAt: '2026-01-01',
    });
  });

  await assertSucceeds(updateDoc(doc(db('runner'), 'runners', 'runner_race_lock_test'), { fullName: 'Runner Pre-Race', age: 26 }));

  await env.withSecurityRulesDisabled((ctx) => updateDoc(doc(ctx.firestore(), 'races', 'race_lock_test'), { gunStartTime: '2026-12-01T05:00:00Z' }));
  await assertFails(updateDoc(doc(db('runner'), 'runners', 'runner_race_lock_test'), { fullName: 'Runner Cheating' }));
  await assertFails(updateDoc(doc(db('runner'), 'runners', 'runner_race_lock_test'), { gender: 'female' }));
  await assertFails(updateDoc(doc(db('runner'), 'runners', 'runner_race_lock_test'), { distance: '10K' }));
  await assertSucceeds(updateDoc(doc(db('runner'), 'runners', 'runner_race_lock_test'), {
    emergencyContactName: 'Jane Doe',
    emergencyContactPhone: '09171234567',
    shirtSize: 'M',
  }));
  await assertSucceeds(updateDoc(doc(db('organizer'), 'runners', 'runner_race_lock_test'), { fullName: 'Organizer Corrected' }));

  await env.withSecurityRulesDisabled(async (ctx) => {
    const root = ctx.firestore();
    await updateDoc(doc(root, 'races', 'race_lock_test'), { gunStartTime: '' });
    await updateDoc(doc(root, 'runners', 'runner_race_lock_test'), { kitClaimedAt: '2026-11-30T10:00:00Z' });
  });
  await assertFails(updateDoc(doc(db('runner'), 'runners', 'runner_race_lock_test'), { age: 29 }));
  await assertSucceeds(updateDoc(doc(db('runner'), 'runners', 'runner_race_lock_test'), { shirtSize: 'L' }));
});

test('bibCounters restricts runner self-registration to atomic +1 with runner doc while preserving staff bulk limits', async () => {
  const runnerOneDb = env.authenticatedContext('reg_u1', { email: 'reg1@example.com', email_verified: true }).firestore();
  const runnerTwoDb = env.authenticatedContext('reg_u2', { email: 'reg2@example.com', email_verified: true }).firestore();

  await env.withSecurityRulesDisabled(async (ctx) => {
    const root = ctx.firestore();
    for (const uid of ['reg_u1', 'reg_u2']) {
      await setDoc(doc(root, 'users', uid), { uid, role: 'runner', approved: true, email: `${uid}@example.com`, displayName: uid, createdAt: '2026-01-01' });
    }
    await setDoc(doc(root, 'races', 'race_bib_tx'), {
      id: 'race_bib_tx',
      createdBy: 'organizer',
      createdAt: '2026-01-01',
      name: 'Bib TX Race',
      date: '2026-12-01',
      registrationOpen: true,
      checkpoints: [],
      distances: [{ id: '5K', label: '5K', km: 5, price: 0 }],
    });
  });

  await assertFails(setDoc(doc(runnerOneDb, 'bibCounters', 'race_bib_tx_5K_solo'), { raceId: 'race_bib_tx', count: 1 }));
  await assertFails(runTransaction(runnerOneDb, async (tx) => {
    tx.set(doc(runnerOneDb, 'bibCounters', 'race_bib_tx_5K_solo'), { raceId: 'race_bib_tx', count: 2 });
    tx.set(doc(runnerOneDb, 'runners', 'reg_u1_race_bib_tx'), {
      uid: 'reg_u1', raceId: 'race_bib_tx', fullName: 'Reg One', bibNumber: '5-002', distance: '5K', gender: 'male', age: 25, createdAt: '2026-01-01',
    });
  }));

  await assertSucceeds(runTransaction(runnerOneDb, async (tx) => {
    tx.set(doc(runnerOneDb, 'bibCounters', 'race_bib_tx_5K_solo'), { raceId: 'race_bib_tx', count: 1 });
    tx.set(doc(runnerOneDb, 'runners', 'reg_u1_race_bib_tx'), {
      uid: 'reg_u1', raceId: 'race_bib_tx', fullName: 'Reg One', bibNumber: '5-001', distance: '5K', gender: 'male', age: 25, createdAt: '2026-01-01',
    });
  }));

  await assertFails(setDoc(doc(runnerOneDb, 'bibCounters', 'race_bib_tx_5K_solo'), { raceId: 'race_bib_tx', count: 2 }));

  await assertSucceeds(runTransaction(runnerTwoDb, async (tx) => {
    tx.set(doc(runnerTwoDb, 'bibCounters', 'race_bib_tx_5K_solo'), { raceId: 'race_bib_tx', count: 2 });
    tx.set(doc(runnerTwoDb, 'runners', 'reg_u2_race_bib_tx'), {
      uid: 'reg_u2', raceId: 'race_bib_tx', fullName: 'Reg Two', bibNumber: '5-002', distance: '5K', gender: 'female', age: 27, createdAt: '2026-01-01',
    });
  }));

  await assertSucceeds(setDoc(doc(db('organizer'), 'bibCounters', 'race_bib_tx_10K_solo'), { raceId: 'race_bib_tx', count: 500 }));
  await assertSucceeds(updateDoc(doc(db('organizer'), 'bibCounters', 'race_bib_tx_10K_solo'), { count: 1000 }));
});

test('chipReads, user profile URLs, large distance lists, and engraving orders enforce strict schema and bounds', async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const root = ctx.firestore();
    await setDoc(doc(root, 'races', 'race_open_chip'), {
      id: 'race_open_chip',
      createdBy: 'organizer',
      createdAt: '2026-01-01',
      name: 'Open Chip Race',
      date: '2026-12-01',
      registrationOpen: true,
      manualPaymentEnabled: true,
      checkpoints: [],
      distances: Array.from({ length: 20 }, (_, idx) => ({
        id: `d${idx + 1}`,
        label: `${idx + 1}K`,
        km: idx + 1,
        price: idx === 19 ? 1500 : 0,
      })),
    });
  });

  const validChip = {
    id: 'read_1',
    raceId: 'race_open_chip',
    bibNumber: '5-001',
    chipId: 'E200001234',
    checkpointId: 'start',
    timestamp: '2026-12-01T05:00:00Z',
    source: 'rfid-bridge',
    recordedBy: 'organizer',
    createdAt: '2026-12-01T05:00:00Z',
    bridgeEventId: 'evt_1',
    antenna: 4,
    readerSequence: 12,
    monotonicTicks: '123456',
    monotonicFrequency: '10000000',
    clockSource: 'bridge-receipt',
  };
  await assertSucceeds(setDoc(doc(db('organizer'), 'chipReads', 'read_1'), validChip));
  await assertFails(setDoc(doc(db('organizer'), 'chipReads', 'read_extra'), { ...validChip, id: 'read_extra', extraField: 'nope' }));
  await assertFails(setDoc(doc(db('organizer'), 'chipReads', 'read_bad_ant'), { ...validChip, id: 'read_bad_ant', antenna: 9 }));

  await assertSucceeds(updateDoc(doc(db('runner'), 'users', 'runner'), {
    photoURL: 'data:image/jpeg;base64,abc123==',
    coverURL: 'https://storage.googleapis.com/bucket/cover.jpg',
    socialLink: 'https://strava.com/athletes/1',
  }));
  await assertFails(updateDoc(doc(db('runner'), 'users', 'runner'), { photoURL: 'javascript:alert(1)' }));
  await assertFails(updateDoc(doc(db('runner'), 'users', 'runner'), { coverURL: 'data:image/svg+xml;base64,PHN2Zz4=' }));
  await assertFails(updateDoc(doc(db('runner'), 'users', 'runner'), { socialLink: 'javascript:alert(1)' }));
  await assertFails(updateDoc(doc(db('runner'), 'users', 'runner'), { socialLink: 'https://example.com/<script>' }));

  const u15Db = env.authenticatedContext('dist_u15', { email: 'dist15@example.com', email_verified: true }).firestore();
  const u15PaidDb = env.authenticatedContext('dist_u15_paid', { email: 'dist15p@example.com', email_verified: true }).firestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const root = ctx.firestore();
    await setDoc(doc(root, 'users', 'dist_u15'), { uid: 'dist_u15', role: 'runner', approved: true, email: 'dist15@example.com', displayName: 'U15', createdAt: '2026-01-01' });
    await setDoc(doc(root, 'users', 'dist_u15_paid'), { uid: 'dist_u15_paid', role: 'runner', approved: true, email: 'dist15p@example.com', displayName: 'U15P', createdAt: '2026-01-01' });
  });

  await assertFails(setDoc(doc(u15Db, 'runners', 'dist_u15_race_open_chip'), {
    uid: 'dist_u15', raceId: 'race_open_chip', fullName: 'Unknown Dist', bibNumber: '99-001', distance: 'FAKE_FREE', gender: 'male', age: 25, createdAt: '2026-01-01',
  }));
  await assertFails(setDoc(doc(u15Db, 'runners', 'dist_u15_race_open_chip'), {
    uid: 'dist_u15', raceId: 'race_open_chip', fullName: 'Paid Bypass', bibNumber: '20-001', distance: '20K', gender: 'male', age: 25, createdAt: '2026-01-01',
  }));
  await assertSucceeds(setDoc(doc(u15Db, 'runners', 'dist_u15_race_open_chip'), {
    uid: 'dist_u15', raceId: 'race_open_chip', fullName: 'Free Index 18', bibNumber: '19-001', distance: '19K', gender: 'male', age: 25, createdAt: '2026-01-01',
  }));
  await assertFails(setDoc(doc(u15PaidDb, 'runners', 'dist_u15_paid_race_open_chip'), {
    uid: 'dist_u15_paid', raceId: 'race_open_chip', fullName: 'Underpay', bibNumber: '20-002', distance: '20K', gender: 'female', age: 25, createdAt: '2026-01-01',
    paymentStatus: 'pending', paymentMethod: 'manual', paymentAmount: 100, paymentReference: 'REF-1234',
  }));
  await assertSucceeds(setDoc(doc(u15PaidDb, 'runners', 'dist_u15_paid_race_open_chip'), {
    uid: 'dist_u15_paid', raceId: 'race_open_chip', fullName: 'Full Pay', bibNumber: '20-002', distance: '20K', gender: 'female', age: 25, createdAt: '2026-01-01',
    paymentStatus: 'pending', paymentMethod: 'manual', paymentAmount: 1500, paymentReference: 'REF-1234',
  }));

  await assertSucceeds(setDoc(doc(db('runner'), 'orders', 'ORD1'), {
    id: 'ORD1', ownerUid: 'runner', runnerName: 'Runner', bibNumber: '5-001', distance: '5K', finishingTime: '00:20:00.1234567', status: 'queued', createdAt: '2026-01-01', updatedAt: '2026-01-01',
  }));
  await assertFails(setDoc(doc(db('runner'), 'orders', 'ORD2'), {
    id: 'ORD2', ownerUid: 'runner', runnerName: 'Runner', bibNumber: '5-001', distance: '5K', finishingTime: '00:20:00', status: 'queued', createdAt: '2026-01-01', updatedAt: '2026-01-01', extraHack: true,
  }));
  await assertFails(setDoc(doc(db('runner'), 'orders', 'ORD3'), {
    id: 'ORD3', ownerUid: 'runner', runnerName: 'Runner', bibNumber: '5-001', distance: '5K', finishingTime: '0'.repeat(33), status: 'queued', createdAt: '2026-01-01', updatedAt: '2026-01-01',
  }));
});

test('users/{uid} enforces safe bounds for Milestone 1-5 profile fields and organizer cannot access badges/clubs permissions', async () => {
  await assertSucceeds(updateDoc(doc(db('runner'), 'users', 'runner'), {
    weightKg: 68,
    heightCm: 172,
    onboardingSteps: ['welcome'],
    primaryClubId: '',
    allowMessageRequests: true,
  }));
  await assertSucceeds(updateDoc(doc(db('runner'), 'users', 'runner'), {
    weightKg: null,
    heightCm: null,
    onboardingSteps: null,
    primaryClubId: 'club_manila_01',
    allowMessageRequests: false,
  }));

  await assertFails(updateDoc(doc(db('runner'), 'users', 'runner'), { weightKg: 0 }));
  await assertFails(updateDoc(doc(db('runner'), 'users', 'runner'), { weightKg: -5 }));
  await assertFails(updateDoc(doc(db('runner'), 'users', 'runner'), { weightKg: 24.9 }));
  await assertFails(updateDoc(doc(db('runner'), 'users', 'runner'), { weightKg: 250.1 }));
  await assertFails(updateDoc(doc(db('runner'), 'users', 'runner'), { weightKg: 251 }));
  await assertFails(updateDoc(doc(db('runner'), 'users', 'runner'), { weightKg: Number.NaN }));
  await assertFails(updateDoc(doc(db('runner'), 'users', 'runner'), { weightKg: '68' }));
  await assertFails(updateDoc(doc(db('runner'), 'users', 'runner'), { heightCm: 79 }));
  await assertFails(updateDoc(doc(db('runner'), 'users', 'runner'), { heightCm: 251 }));
  await assertFails(updateDoc(doc(db('runner'), 'users', 'runner'), { heightCm: Number.NaN }));
  await assertFails(updateDoc(doc(db('runner'), 'users', 'runner'), { onboardingSteps: Array(11).fill('welcome') }));
  await assertFails(updateDoc(doc(db('runner'), 'users', 'runner'), { onboardingSteps: ['a'.repeat(41)] }));
  await assertFails(updateDoc(doc(db('runner'), 'users', 'runner'), { onboardingSteps: [123] }));
  await assertFails(updateDoc(doc(db('runner'), 'users', 'runner'), { onboardingSteps: ['bad space'] }));
  await assertFails(updateDoc(doc(db('runner'), 'users', 'runner'), { primaryClubId: '../bad' }));
  await assertFails(updateDoc(doc(db('runner'), 'users', 'runner'), { primaryClubId: 'a'.repeat(65) }));
  await assertFails(updateDoc(doc(db('runner'), 'users', 'runner'), { allowMessageRequests: 'yes' }));
  await assertFails(updateDoc(doc(db('runner'), 'users', 'runner'), { extraField: 'polluted' }));

  const authGateFresh = env.authenticatedContext('auth_gate_runner', { email: 'authgate@example.com', email_verified: true }).firestore();
  await assertSucceeds(runTransaction(authGateFresh, async (tx) => {
    tx.set(doc(authGateFresh, 'users', 'auth_gate_runner'), {
      uid: 'auth_gate_runner',
      email: 'authgate@example.com',
      displayName: 'Auth Gate Runner',
      username: 'auth_gate_runner',
      role: 'runner',
      approved: true,
      createdAt: '2026-11-24T00:00:00Z',
      over13Confirmed: true,
      termsAcceptedAt: '2026-11-24T00:00:00Z',
      marketingOptIn: false,
    });
    tx.set(doc(authGateFresh, 'usernameIndex', 'auth_gate_runner'), {
      username: 'auth_gate_runner',
      uid: 'auth_gate_runner',
      email: 'authgate@example.com',
      createdAt: '2026-11-24T00:00:00Z',
    });
  }));
  await assertSucceeds(updateDoc(doc(authGateFresh, 'users', 'auth_gate_runner'), {
    displayName: 'Auth Gate Runner Updated',
    nickname: 'AG',
    photoURL: 'data:image/jpeg;base64,abc123==',
    coverURL: 'https://storage.googleapis.com/bucket/cover.jpg',
    coverPreset: 'crimson-track',
    bio: 'Manila road & trail runner.',
    location: 'Quezon City, PH',
    runClub: 'Legacy Run Club',
    favoriteDistance: '21K',
    socialLink: 'https://strava.com/athletes/99',
    emergencyContactName: 'Juan Dela Cruz',
    emergencyContactPhone: '09171234567',
    shirtSize: 'M',
    medicalNotes: 'None',
    marketingOptIn: true,
    marketingUpdatedAt: '2026-11-24T01:00:00Z',
    weightKg: 68.5,
    heightCm: 172.5,
    onboardingSteps: ['welcome', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9', 's10'],
    primaryClubId: 'club_manila_01',
    allowMessageRequests: true,
  }));

  const rogueFresh = env.authenticatedContext('rogue_runner', { email: 'rogue@example.com', email_verified: true }).firestore();
  await assertFails(setDoc(doc(rogueFresh, 'users', 'rogue_runner'), {
    uid: 'rogue_runner',
    email: 'rogue@example.com',
    displayName: 'Rogue',
    role: 'runner',
    approved: true,
    createdAt: '2026-10-28',
    weightKg: 0,
  }));
  await assertFails(setDoc(doc(rogueFresh, 'users', 'rogue_runner'), {
    uid: 'rogue_runner',
    email: 'rogue@example.com',
    displayName: 'Rogue',
    role: 'runner',
    approved: true,
    createdAt: '2026-10-28',
    extraField: 'polluted',
  }));

  const organizerAccess = await getDoc(doc(db('organizer'), 'userAccess', 'organizer'));
  assert.equal(organizerAccess.exists(), true);
  assert.equal(organizerAccess.data().permissions['badges.manage'], false);
  assert.equal(organizerAccess.data().permissions['clubs.manage'], false);
  assert.equal(policy.can({ uid: 'organizer', role: 'organizer', approved: true }, organizerAccess.data(), 'badges.manage'), false);
  assert.equal(policy.can({ uid: 'organizer', role: 'organizer', approved: true }, organizerAccess.data(), 'clubs.manage'), false);
});

test('compiled firestore.rules helpers enforce organizer exclusions and badge/club view dependencies', async () => {
  const baseRules = fs.readFileSync('firestore.rules', 'utf8');
  const probeRules = baseRules.replace(
    /\r?\n\s*\}\s*\}\s*$/,
    '\n    match /_rbacProbe/{action} {\n      allow read: if permission(action);\n    }\n  }\n}\n',
  );
  assert.notEqual(probeRules, baseRules);

  const probeEnv = await initializeTestEnvironment({
    projectId: 'demo-racepulse-rbac-probe',
    firestore: { host: '127.0.0.1', port: 8080, rules: probeRules },
  });
  try {
    await probeEnv.withSecurityRulesDisabled(async (ctx) => {
      const root = ctx.firestore();
      await setDoc(doc(root, 'users', 'org_legacy'), { uid: 'org_legacy', role: 'organizer', approved: true, email: 'org_legacy@example.com', displayName: 'Org Legacy', createdAt: '2026-01-01' });
      await setDoc(doc(root, 'userAccess', 'org_legacy'), { status: 'active', scope: 'owned-assigned', raceIds: [], overrides: {}, permissions: { 'race.view': true } });

      await setDoc(doc(root, 'users', 'org_dep_bypass'), { uid: 'org_dep_bypass', role: 'organizer', approved: true, email: 'org_dep@example.com', displayName: 'Org Dep', createdAt: '2026-01-01' });
      await setDoc(doc(root, 'userAccess', 'org_dep_bypass'), {
        status: 'active',
        scope: 'owned-assigned',
        raceIds: [],
        overrides: { 'badges.manage': true, 'badges.grant': true, 'clubs.manage': true },
        permissions: { 'race.view': true },
      });

      await setDoc(doc(root, 'users', 'org_badges_ok'), { uid: 'org_badges_ok', role: 'organizer', approved: true, email: 'org_ok@example.com', displayName: 'Org Ok', createdAt: '2026-01-01' });
      await setDoc(doc(root, 'userAccess', 'org_badges_ok'), {
        status: 'active',
        scope: 'owned-assigned',
        raceIds: [],
        overrides: { 'badges.view': true, 'badges.manage': true },
        permissions: { 'race.view': true },
      });

      await setDoc(doc(root, 'users', 'admin_legacy'), { uid: 'admin_legacy', role: 'admin', approved: true, email: 'admin_legacy@example.com', displayName: 'Admin Legacy', createdAt: '2026-01-01' });
      await setDoc(doc(root, 'userAccess', 'admin_legacy'), { status: 'active', scope: 'all', raceIds: [], overrides: {}, permissions: { 'race.view': true } });

      await setDoc(doc(root, 'users', 'admin_view_off'), { uid: 'admin_view_off', role: 'admin', approved: true, email: 'admin_off@example.com', displayName: 'Admin Off', createdAt: '2026-01-01' });
      await setDoc(doc(root, 'userAccess', 'admin_view_off'), {
        status: 'active',
        scope: 'all',
        raceIds: [],
        overrides: { 'badges.view': false, 'clubs.view': false },
        permissions: { 'race.view': true },
      });
    });

    const probeDb = (uid) => probeEnv.authenticatedContext(uid, { email: `${uid}@example.com`, email_verified: true }).firestore();

    for (const blocked of ['badges.view', 'badges.manage', 'badges.grant', 'clubs.view', 'clubs.manage', 'moderation.manage']) {
      await assertFails(getDoc(doc(probeDb('org_legacy'), '_rbacProbe', blocked)));
    }
    for (const personalKey of ['personal.record', 'personal.social', 'personal.clubs', 'personal.inbox']) {
      await assertSucceeds(getDoc(doc(probeDb('org_legacy'), '_rbacProbe', personalKey)));
    }

    await assertFails(getDoc(doc(probeDb('org_dep_bypass'), '_rbacProbe', 'badges.manage')));
    await assertFails(getDoc(doc(probeDb('org_dep_bypass'), '_rbacProbe', 'badges.grant')));
    await assertFails(getDoc(doc(probeDb('org_dep_bypass'), '_rbacProbe', 'clubs.manage')));

    await assertSucceeds(getDoc(doc(probeDb('org_badges_ok'), '_rbacProbe', 'badges.manage')));

    for (const adminAllowed of ['badges.view', 'badges.manage', 'badges.grant', 'clubs.view', 'clubs.manage', 'moderation.manage']) {
      await assertSucceeds(getDoc(doc(probeDb('admin_legacy'), '_rbacProbe', adminAllowed)));
    }

    await assertFails(getDoc(doc(probeDb('admin_view_off'), '_rbacProbe', 'badges.manage')));
    await assertFails(getDoc(doc(probeDb('admin_view_off'), '_rbacProbe', 'badges.grant')));
    await assertFails(getDoc(doc(probeDb('admin_view_off'), '_rbacProbe', 'clubs.manage')));
  } finally {
    await probeEnv.cleanup();
  }
});

test('recordedRuns and communityIdempotency enforce owner, friend, public, superadmin, and server-only write gates', async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const root = ctx.firestore();
    for (const uid of ['run_owner', 'run_friend', 'run_stranger']) {
      await setDoc(doc(root, 'users', uid), {
        uid,
        role: 'runner',
        approved: true,
        email: `${uid}@example.com`,
        displayName: uid,
        createdAt: '2026-11-24',
      });
    }
    await setDoc(doc(root, 'friendships', 'run_owner_run_friend'), {
      fromUid: 'run_owner',
      toUid: 'run_friend',
      members: ['run_owner', 'run_friend'],
      createdAt: '2026-11-24',
    });
    const baseRun = {
      uid: 'run_owner',
      mode: 'free',
      title: 'Morning 5K',
      startedAt: '2026-11-24T06:00:00Z',
      finishedAt: '2026-11-24T06:25:00Z',
      elapsedTimeMs: 1500000,
      movingTimeMs: 1500000,
      distanceM: 5000,
      verificationStatus: 'verified',
      verificationFlags: [],
      createdAt: '2026-11-24T06:25:00Z',
    };
    await setDoc(doc(root, 'recordedRuns', 'run_private'), { ...baseRun, runId: 'run_private', privacy: 'private' });
    await setDoc(doc(root, 'recordedRuns', 'run_friends'), { ...baseRun, runId: 'run_friends', privacy: 'friends' });
    await setDoc(doc(root, 'recordedRuns', 'run_public'), { ...baseRun, runId: 'run_public', privacy: 'public' });
    await setDoc(doc(root, 'communityIdempotency', 'run_owner_req1'), {
      digest: 'abc',
      response: { ok: true },
      createdAt: '2026-11-24T06:25:00Z',
    });
  });

  const anonDb = env.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(anonDb, 'recordedRuns', 'run_public')));
  await assertFails(getDoc(doc(anonDb, 'recordedRuns', 'run_friends')));
  await assertFails(getDoc(doc(anonDb, 'recordedRuns', 'run_private')));
  await assertFails(getDoc(doc(anonDb, 'communityIdempotency', 'run_owner_req1')));

  // Owner can read all own runs (including query) but cannot create/update/delete via client SDK
  await assertSucceeds(getDoc(doc(db('run_owner'), 'recordedRuns', 'run_private')));
  await assertSucceeds(getDoc(doc(db('run_owner'), 'recordedRuns', 'run_friends')));
  await assertSucceeds(getDoc(doc(db('run_owner'), 'recordedRuns', 'run_public')));
  await assertSucceeds(getDocs(query(collection(db('run_owner'), 'recordedRuns'), where('uid', '==', 'run_owner'))));
  await assertFails(setDoc(doc(db('run_owner'), 'recordedRuns', 'run_forged'), { runId: 'run_forged', uid: 'run_owner', privacy: 'public' }));
  await assertFails(updateDoc(doc(db('run_owner'), 'recordedRuns', 'run_private'), { title: 'Tampered' }));
  await assertFails(deleteDoc(doc(db('run_owner'), 'recordedRuns', 'run_private')));

  // Superadmin can read all runs, still cannot write via client SDK
  await assertSucceeds(getDoc(doc(db('superadmin'), 'recordedRuns', 'run_private')));
  await assertSucceeds(getDoc(doc(db('superadmin'), 'recordedRuns', 'run_friends')));
  await assertSucceeds(getDoc(doc(db('superadmin'), 'recordedRuns', 'run_public')));
  await assertFails(setDoc(doc(db('superadmin'), 'recordedRuns', 'run_sa_forged'), { runId: 'run_sa_forged', uid: 'superadmin', privacy: 'public' }));
  await assertFails(updateDoc(doc(db('superadmin'), 'recordedRuns', 'run_private'), { verificationStatus: 'verified' }));
  await assertFails(deleteDoc(doc(db('superadmin'), 'recordedRuns', 'run_private')));

  // Friend can read public & friends runs via isFriendOf, not private
  await assertSucceeds(getDoc(doc(db('run_friend'), 'recordedRuns', 'run_public')));
  await assertSucceeds(getDoc(doc(db('run_friend'), 'recordedRuns', 'run_friends')));
  await assertFails(getDoc(doc(db('run_friend'), 'recordedRuns', 'run_private')));

  // Non-friend signed-in user can read public, not friends or private
  await assertSucceeds(getDoc(doc(db('run_stranger'), 'recordedRuns', 'run_public')));
  await assertFails(getDoc(doc(db('run_stranger'), 'recordedRuns', 'run_friends')));
  await assertFails(getDoc(doc(db('run_stranger'), 'recordedRuns', 'run_private')));

  // communityIdempotency is completely locked from client reads and writes
  await assertFails(getDoc(doc(db('run_owner'), 'communityIdempotency', 'run_owner_req1')));
  await assertFails(getDoc(doc(db('superadmin'), 'communityIdempotency', 'run_owner_req1')));
  await assertFails(setDoc(doc(db('run_owner'), 'communityIdempotency', 'run_owner_req2'), { digest: 'x' }));
  await assertFails(setDoc(doc(db('superadmin'), 'communityIdempotency', 'run_owner_req2'), { digest: 'x' }));
});

test('badges, userBadges, xpEvents, and athleteProgression enforce RBAC read scopes and server-only writes', async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const root = ctx.firestore();
    const makeAccess = (user, overrides = {}, extra = {}) => {
      const state = policy.accessFor(user, { overrides, ...extra });
      state.permissions = Object.fromEntries(policy.keys.map((key) => [key, policy.can(user, state, key)]));
      return state;
    };

    const fixtures = [
      { uid: 'badge_owner', role: 'runner', approved: true },
      { uid: 'badge_owner_removed', role: 'runner', approved: true },
      { uid: 'badge_friend_fwd', role: 'runner', approved: true },
      { uid: 'badge_friend_rev', role: 'runner', approved: true },
      { uid: 'badge_stranger', role: 'runner', approved: true },
      { uid: 'badge_org_default', role: 'organizer', approved: true },
      { uid: 'badge_org_granted', role: 'organizer', approved: true, overrides: { 'badges.view': true } },
      { uid: 'badge_org_pending_granted', role: 'organizer', approved: false, overrides: { 'badges.view': true } },
      { uid: 'badge_admin_default', role: 'admin', approved: true },
      { uid: 'badge_admin_revoked', role: 'admin', approved: true, overrides: { 'badges.view': false } },
      { uid: 'badge_admin_suspended', role: 'admin', approved: true, extra: { status: 'suspended' } },
      { uid: 'badge_sa_active', role: 'superadmin', approved: true },
      { uid: 'badge_sa_suspended', role: 'superadmin', approved: true, extra: { status: 'suspended' } },
      { uid: 'badge_sa_removed', role: 'superadmin', approved: true },
    ];

    for (const entry of fixtures) {
      const user = {
        uid: entry.uid,
        role: entry.role,
        approved: entry.approved,
        email: `${entry.uid}@example.com`,
        displayName: entry.uid,
        createdAt: '2026-11-25',
      };
      await setDoc(doc(root, 'users', entry.uid), user);
      await setDoc(doc(root, 'userAccess', entry.uid), makeAccess(user, entry.overrides, entry.extra));
    }

    // Legacy admin omitting badges.view in permissions and admin with no userAccess document
    await setDoc(doc(root, 'users', 'badge_admin_legacy'), {
      uid: 'badge_admin_legacy',
      role: 'admin',
      approved: true,
      email: 'badge_admin_legacy@example.com',
      displayName: 'Legacy Admin',
      createdAt: '2026-11-25',
    });
    await setDoc(doc(root, 'userAccess', 'badge_admin_legacy'), {
      status: 'active',
      scope: 'all',
      raceIds: [],
      overrides: {},
      permissions: { 'race.view': true },
    });
    await setDoc(doc(root, 'users', 'badge_admin_no_access'), {
      uid: 'badge_admin_no_access',
      role: 'admin',
      approved: true,
      email: 'badge_admin_no_access@example.com',
      displayName: 'No Access Doc Admin',
      createdAt: '2026-11-25',
    });

    // Removed account tombstones
    await setDoc(doc(root, 'removedAccounts', 'badge_owner_removed'), {
      uid: 'badge_owner_removed',
      removedAt: '2026-11-25T00:00:00Z',
    });
    await setDoc(doc(root, 'removedAccounts', 'badge_sa_removed'), {
      uid: 'badge_sa_removed',
      removedAt: '2026-11-25T00:00:00Z',
    });

    // Friendships in both directions
    await setDoc(doc(root, 'friendships', 'badge_friend_fwd_badge_owner'), {
      fromUid: 'badge_friend_fwd',
      toUid: 'badge_owner',
      members: ['badge_friend_fwd', 'badge_owner'],
      createdAt: '2026-11-25',
    });
    await setDoc(doc(root, 'friendships', 'badge_owner_badge_friend_rev'), {
      fromUid: 'badge_owner',
      toUid: 'badge_friend_rev',
      members: ['badge_owner', 'badge_friend_rev'],
      createdAt: '2026-11-25',
    });

    // Badge Studio & XP Progression documents
    await setDoc(doc(root, 'badges', 'welcome_pacer'), {
      badgeId: 'welcome_pacer',
      name: 'First Stride',
      description: 'Welcome to RacePulsePH.',
      tier: 'common',
      category: 'onboarding',
      artworkType: 'emblem',
      emblemId: 'sunrise-burst',
      artworkUrl: '',
      borderStyle: 'solid-ring',
      primaryColor: '#DC2626',
      secondaryColor: '#F59E0B',
      animationEffect: 'none',
      xpReward: 100,
      rule: { type: 'welcome' },
      hiddenUntilEarned: false,
      status: 'active',
      sortOrder: 10,
      createdAt: '2026-11-25T00:00:00Z',
      createdBy: 'badge_sa_active',
      updatedAt: '2026-11-25T00:00:00Z',
      updatedBy: 'badge_sa_active',
    });

    await setDoc(doc(root, 'userBadges', 'badge_owner_welcome_pacer'), {
      id: 'badge_owner_welcome_pacer',
      uid: 'badge_owner',
      badgeId: 'welcome_pacer',
      badgeName: 'First Stride',
      tier: 'common',
      xpAwarded: 100,
      awardedAt: '2026-11-25T00:00:00Z',
      awardedBy: 'system',
      source: 'auto',
      seenAt: null,
    });
    await setDoc(doc(root, 'userBadges', 'badge_owner_removed_welcome_pacer'), {
      id: 'badge_owner_removed_welcome_pacer',
      uid: 'badge_owner_removed',
      badgeId: 'welcome_pacer',
      badgeName: 'First Stride',
      tier: 'common',
      xpAwarded: 100,
      awardedAt: '2026-11-25T00:00:00Z',
      awardedBy: 'system',
      source: 'auto',
      seenAt: null,
    });

    await setDoc(doc(root, 'xpEvents', 'xp_owner_1'), {
      id: 'xp_owner_1',
      uid: 'badge_owner',
      sourceType: 'badge_unlock',
      sourceId: 'welcome_pacer',
      amount: 100,
      description: 'Unlocked First Stride',
      createdAt: '2026-11-25T00:00:00Z',
    });
    await setDoc(doc(root, 'xpEvents', 'xp_removed_1'), {
      id: 'xp_removed_1',
      uid: 'badge_owner_removed',
      sourceType: 'badge_unlock',
      sourceId: 'welcome_pacer',
      amount: 100,
      description: 'Unlocked First Stride',
      createdAt: '2026-11-25T00:00:00Z',
    });

    await setDoc(doc(root, 'athleteProgression', 'badge_owner'), {
      uid: 'badge_owner',
      totalXp: 100,
      level: 2,
      currentLevelXp: 100,
      nextLevelXp: 300,
      rankTitle: 'Pacer',
      badgesEarnedCount: 1,
      runStreakWeeks: 1,
      runStreakGraceRemaining: 0,
      updatedAt: '2026-11-25T00:00:00Z',
    });
    await setDoc(doc(root, 'athleteProgression', 'badge_owner_removed'), {
      uid: 'badge_owner_removed',
      totalXp: 100,
      level: 2,
      currentLevelXp: 100,
      nextLevelXp: 300,
      rankTitle: 'Pacer',
      badgesEarnedCount: 1,
      runStreakWeeks: 1,
      runStreakGraceRemaining: 0,
      updatedAt: '2026-11-25T00:00:00Z',
    });
  });

  const anonDb = env.unauthenticatedContext().firestore();
  const unverifiedNoDocDb = env.authenticatedContext('unverified_no_doc', { email: 'unv@example.com', email_verified: false }).firestore();
  const unverifiedFriendRevDb = env.authenticatedContext('badge_friend_rev', { email: 'badge_friend_rev@example.com', email_verified: false }).firestore();

  // 1. badges/{badgeId}: active signed-in users can get/list; unauthenticated, unverified-without-doc, and removed denied; writes denied for all
  await assertFails(getDoc(doc(anonDb, 'badges', 'welcome_pacer')));
  await assertFails(getDocs(collection(anonDb, 'badges')));
  await assertFails(getDoc(doc(unverifiedNoDocDb, 'badges', 'welcome_pacer')));
  await assertFails(getDocs(collection(unverifiedNoDocDb, 'badges')));
  await assertFails(getDoc(doc(db('badge_owner_removed'), 'badges', 'welcome_pacer')));
  await assertFails(getDocs(collection(db('badge_owner_removed'), 'badges')));
  await assertFails(getDoc(doc(db('badge_sa_removed'), 'badges', 'welcome_pacer')));

  for (const uid of ['badge_owner', 'badge_stranger', 'badge_org_default', 'badge_admin_default', 'badge_sa_active']) {
    await assertSucceeds(getDoc(doc(db(uid), 'badges', 'welcome_pacer')));
    await assertSucceeds(getDocs(collection(db(uid), 'badges')));
    await assertSucceeds(getDocs(query(collection(db(uid), 'badges'), where('status', '==', 'active'))));
    await assertSucceeds(getDocs(query(collection(db(uid), 'badges'), orderBy('sortOrder', 'asc'))));
  }
  for (const uid of ['badge_owner', 'badge_org_default', 'badge_admin_default', 'badge_sa_active']) {
    await assertFails(setDoc(doc(db(uid), 'badges', 'forged_badge'), { badgeId: 'forged_badge', name: 'Forged' }));
    await assertFails(updateDoc(doc(db(uid), 'badges', 'welcome_pacer'), { xpReward: 999999 }));
    await assertFails(deleteDoc(doc(db(uid), 'badges', 'welcome_pacer')));
  }

  // 2. userBadges/{docId}: owner, friend, admin (badges.view), superadmin can read; non-friend, default organizer, unauth, removed denied; writes denied
  await assertFails(getDoc(doc(anonDb, 'userBadges', 'badge_owner_welcome_pacer')));
  await assertFails(getDocs(collection(anonDb, 'userBadges')));
  await assertFails(getDoc(doc(unverifiedNoDocDb, 'userBadges', 'badge_owner_welcome_pacer')));
  await assertFails(getDoc(doc(db('badge_owner_removed'), 'userBadges', 'badge_owner_removed_welcome_pacer')));
  await assertFails(getDoc(doc(db('badge_sa_removed'), 'userBadges', 'badge_owner_welcome_pacer')));
  await assertFails(getDoc(doc(db('badge_stranger'), 'userBadges', 'badge_owner_welcome_pacer')));
  await assertFails(getDoc(doc(db('runner'), 'userBadges', 'badge_owner_welcome_pacer')));
  await assertFails(getDocs(query(collection(db('badge_stranger'), 'userBadges'), where('uid', '==', 'badge_owner'))));
  await assertFails(getDoc(doc(db('badge_org_default'), 'userBadges', 'badge_owner_welcome_pacer')));
  await assertFails(getDoc(doc(db('organizer'), 'userBadges', 'badge_owner_welcome_pacer')));
  await assertFails(getDocs(collection(db('badge_org_default'), 'userBadges')));
  await assertFails(getDoc(doc(db('badge_org_pending_granted'), 'userBadges', 'badge_owner_welcome_pacer')));
  await assertFails(getDoc(doc(db('badge_admin_revoked'), 'userBadges', 'badge_owner_welcome_pacer')));
  await assertFails(getDocs(collection(db('badge_admin_revoked'), 'userBadges')));
  await assertFails(getDoc(doc(db('badge_admin_suspended'), 'userBadges', 'badge_owner_welcome_pacer')));
  await assertFails(getDoc(doc(db('badge_sa_suspended'), 'userBadges', 'badge_owner_welcome_pacer')));
  await assertFails(getDocs(collection(db('badge_owner'), 'userBadges')));
  await assertFails(getDocs(collection(db('badge_friend_fwd'), 'userBadges')));

  await assertSucceeds(getDoc(doc(db('badge_owner'), 'userBadges', 'badge_owner_welcome_pacer')));
  await assertSucceeds(getDocs(query(collection(db('badge_owner'), 'userBadges'), where('uid', '==', 'badge_owner'))));
  await assertSucceeds(getDoc(doc(db('badge_friend_fwd'), 'userBadges', 'badge_owner_welcome_pacer')));
  await assertSucceeds(getDoc(doc(db('badge_friend_rev'), 'userBadges', 'badge_owner_welcome_pacer')));
  await assertSucceeds(getDoc(doc(unverifiedFriendRevDb, 'userBadges', 'badge_owner_welcome_pacer')));
  await assertSucceeds(getDocs(query(collection(db('badge_friend_fwd'), 'userBadges'), where('uid', '==', 'badge_owner'))));
  await assertSucceeds(getDocs(query(collection(db('badge_friend_rev'), 'userBadges'), where('uid', '==', 'badge_owner'))));
  await assertSucceeds(getDoc(doc(db('badge_org_granted'), 'userBadges', 'badge_owner_welcome_pacer')));
  for (const adminUid of ['badge_admin_default', 'badge_admin_legacy', 'badge_admin_no_access', 'badge_sa_active']) {
    await assertSucceeds(getDoc(doc(db(adminUid), 'userBadges', 'badge_owner_welcome_pacer')));
    await assertSucceeds(getDocs(collection(db(adminUid), 'userBadges')));
    await assertSucceeds(getDocs(query(collection(db(adminUid), 'userBadges'), where('uid', '==', 'badge_owner'))));
  }
  for (const uid of ['badge_owner', 'badge_friend_fwd', 'badge_admin_default', 'badge_sa_active']) {
    await assertFails(setDoc(doc(db(uid), 'userBadges', 'badge_owner_forged'), { id: 'badge_owner_forged', uid: 'badge_owner', badgeId: 'welcome_pacer' }));
    await assertFails(updateDoc(doc(db(uid), 'userBadges', 'badge_owner_welcome_pacer'), { seenAt: '2026-11-25T01:00:00Z' }));
    await assertFails(deleteDoc(doc(db(uid), 'userBadges', 'badge_owner_welcome_pacer')));
  }

  // 3. xpEvents/{eventId}: ONLY owner or isSuperAdmin() can read; friends, organizers, admins, strangers, removed denied; writes denied
  await assertFails(getDoc(doc(anonDb, 'xpEvents', 'xp_owner_1')));
  await assertFails(getDocs(collection(anonDb, 'xpEvents')));
  await assertFails(getDoc(doc(unverifiedNoDocDb, 'xpEvents', 'xp_owner_1')));
  await assertFails(getDoc(doc(db('badge_owner_removed'), 'xpEvents', 'xp_removed_1')));
  await assertFails(getDoc(doc(db('badge_sa_removed'), 'xpEvents', 'xp_owner_1')));
  await assertFails(getDoc(doc(db('badge_sa_suspended'), 'xpEvents', 'xp_owner_1')));
  await assertFails(getDoc(doc(db('badge_friend_fwd'), 'xpEvents', 'xp_owner_1')));
  await assertFails(getDoc(doc(db('badge_friend_rev'), 'xpEvents', 'xp_owner_1')));
  await assertFails(getDocs(query(collection(db('badge_friend_fwd'), 'xpEvents'), where('uid', '==', 'badge_owner'))));
  await assertFails(getDoc(doc(db('badge_stranger'), 'xpEvents', 'xp_owner_1')));
  await assertFails(getDoc(doc(db('runner'), 'xpEvents', 'xp_owner_1')));
  await assertFails(getDoc(doc(db('badge_org_default'), 'xpEvents', 'xp_owner_1')));
  await assertFails(getDoc(doc(db('organizer'), 'xpEvents', 'xp_owner_1')));
  await assertFails(getDoc(doc(db('badge_org_granted'), 'xpEvents', 'xp_owner_1')));
  await assertFails(getDoc(doc(db('badge_admin_default'), 'xpEvents', 'xp_owner_1')));
  await assertFails(getDocs(collection(db('badge_admin_default'), 'xpEvents')));
  await assertFails(getDocs(query(collection(db('badge_admin_default'), 'xpEvents'), where('uid', '==', 'badge_owner'))));
  await assertFails(getDocs(collection(db('badge_owner'), 'xpEvents')));

  await assertSucceeds(getDoc(doc(db('badge_owner'), 'xpEvents', 'xp_owner_1')));
  await assertSucceeds(getDocs(query(collection(db('badge_owner'), 'xpEvents'), where('uid', '==', 'badge_owner'))));
  await assertSucceeds(getDoc(doc(db('badge_sa_active'), 'xpEvents', 'xp_owner_1')));
  await assertSucceeds(getDocs(collection(db('badge_sa_active'), 'xpEvents')));

  for (const uid of ['badge_owner', 'badge_admin_default', 'badge_sa_active']) {
    await assertFails(setDoc(doc(db(uid), 'xpEvents', 'xp_forged'), { id: 'xp_forged', uid: 'badge_owner', amount: 50000 }));
    await assertFails(updateDoc(doc(db(uid), 'xpEvents', 'xp_owner_1'), { amount: 99999 }));
    await assertFails(deleteDoc(doc(db(uid), 'xpEvents', 'xp_owner_1')));
  }

  // 4. athleteProgression/{uid}: owner, friend, admin (badges.view), superadmin can read; non-friend, default organizer, unauth, removed denied; writes denied
  await assertFails(getDoc(doc(anonDb, 'athleteProgression', 'badge_owner')));
  await assertFails(getDocs(collection(anonDb, 'athleteProgression')));
  await assertFails(getDoc(doc(unverifiedNoDocDb, 'athleteProgression', 'badge_owner')));
  await assertFails(getDoc(doc(db('badge_owner_removed'), 'athleteProgression', 'badge_owner_removed')));
  await assertFails(getDoc(doc(db('badge_sa_removed'), 'athleteProgression', 'badge_owner')));
  await assertFails(getDoc(doc(db('badge_stranger'), 'athleteProgression', 'badge_owner')));
  await assertFails(getDoc(doc(db('runner'), 'athleteProgression', 'badge_owner')));
  await assertFails(getDocs(collection(db('badge_stranger'), 'athleteProgression')));
  await assertFails(getDoc(doc(db('badge_org_default'), 'athleteProgression', 'badge_owner')));
  await assertFails(getDoc(doc(db('organizer'), 'athleteProgression', 'badge_owner')));
  await assertFails(getDocs(collection(db('badge_org_default'), 'athleteProgression')));
  await assertFails(getDoc(doc(db('badge_org_pending_granted'), 'athleteProgression', 'badge_owner')));
  await assertFails(getDoc(doc(db('badge_admin_revoked'), 'athleteProgression', 'badge_owner')));
  await assertFails(getDocs(collection(db('badge_admin_revoked'), 'athleteProgression')));
  await assertFails(getDoc(doc(db('badge_admin_suspended'), 'athleteProgression', 'badge_owner')));
  await assertFails(getDoc(doc(db('badge_sa_suspended'), 'athleteProgression', 'badge_owner')));
  await assertFails(getDocs(collection(db('badge_owner'), 'athleteProgression')));
  await assertFails(getDocs(collection(db('badge_friend_fwd'), 'athleteProgression')));

  await assertSucceeds(getDoc(doc(db('badge_owner'), 'athleteProgression', 'badge_owner')));
  await assertSucceeds(getDoc(doc(db('badge_stranger'), 'athleteProgression', 'badge_stranger')));
  await assertSucceeds(getDoc(doc(db('badge_friend_fwd'), 'athleteProgression', 'badge_owner')));
  await assertSucceeds(getDoc(doc(db('badge_friend_rev'), 'athleteProgression', 'badge_owner')));
  await assertSucceeds(getDoc(doc(unverifiedFriendRevDb, 'athleteProgression', 'badge_owner')));
  await assertSucceeds(getDoc(doc(db('badge_org_granted'), 'athleteProgression', 'badge_owner')));
  for (const adminUid of ['badge_admin_default', 'badge_admin_legacy', 'badge_admin_no_access', 'badge_sa_active']) {
    await assertSucceeds(getDoc(doc(db(adminUid), 'athleteProgression', 'badge_owner')));
    await assertSucceeds(getDocs(collection(db(adminUid), 'athleteProgression')));
  }
  for (const uid of ['badge_owner', 'badge_friend_fwd', 'badge_admin_default', 'badge_sa_active']) {
    await assertFails(setDoc(doc(db(uid), 'athleteProgression', 'badge_owner'), { uid: 'badge_owner', totalXp: 999999, level: 99 }));
    await assertFails(updateDoc(doc(db(uid), 'athleteProgression', 'badge_owner'), { totalXp: 999999 }));
    await assertFails(deleteDoc(doc(db(uid), 'athleteProgression', 'badge_owner')));
  }
});

test('Milestone 4 clubs, social, inbox, moderation, and notifications enforce least-privilege reads and deny all client writes', async () => {
  const longDmA = 'm4_long_uid_aaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const longDmB = 'm4_long_uid_bbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  const longDmConvId = `dm_${longDmA}_${longDmB}`;

  await env.withSecurityRulesDisabled(async (ctx) => {
    const root = ctx.firestore();
    const makeAccess = (user, overrides = {}, extra = {}) => {
      const state = policy.accessFor(user, { overrides, ...extra });
      state.permissions = Object.fromEntries(policy.keys.map((key) => [key, policy.can(user, state, key)]));
      return state;
    };

    const fixtures = [
      { uid: 'm4_author', role: 'runner', approved: true },
      { uid: 'm4_friend', role: 'runner', approved: true },
      { uid: 'm4_close_friend', role: 'runner', approved: true },
      { uid: 'm4_commenter', role: 'runner', approved: true },
      { uid: 'm4_stranger', role: 'runner', approved: true },
      { uid: 'm4_blocked_out', role: 'runner', approved: true },
      { uid: 'm4_blocked_in', role: 'runner', approved: true },
      { uid: 'm4_captain', role: 'runner', approved: true },
      { uid: 'm4_club_member', role: 'runner', approved: true },
      { uid: 'm4_club_pending', role: 'runner', approved: true },
      { uid: 'm4_removed_user', role: 'runner', approved: true },
      { uid: 'm4_org_default', role: 'organizer', approved: true },
      { uid: 'm4_org_clubs', role: 'organizer', approved: true, overrides: { 'clubs.view': true } },
      { uid: 'm4_org_mod', role: 'organizer', approved: true, overrides: { 'moderation.manage': true } },
      { uid: 'm4_org_unapproved_granted', role: 'organizer', approved: false, overrides: { 'clubs.view': true, 'moderation.manage': true } },
      { uid: 'm4_admin_default', role: 'admin', approved: true },
      { uid: 'm4_admin_revoked', role: 'admin', approved: true, overrides: { 'clubs.view': false, 'moderation.manage': false } },
      { uid: 'm4_admin_suspended', role: 'admin', approved: true, extra: { status: 'suspended' } },
      { uid: 'm4_sa_active', role: 'superadmin', approved: true },
      { uid: 'm4_sa_suspended', role: 'superadmin', approved: true, extra: { status: 'suspended' } },
      { uid: 'm4_sa_removed', role: 'superadmin', approved: true },
      { uid: longDmA, role: 'runner', approved: true },
      { uid: longDmB, role: 'runner', approved: true },
    ];

    for (const entry of fixtures) {
      const user = {
        uid: entry.uid,
        role: entry.role,
        approved: entry.approved,
        email: `${entry.uid}@example.com`,
        displayName: entry.uid,
        createdAt: '2026-11-25',
      };
      await setDoc(doc(root, 'users', entry.uid), user);
      await setDoc(doc(root, 'userAccess', entry.uid), makeAccess(user, entry.overrides, entry.extra));
    }

    // Legacy admin omitting M4 permission keys in permissions map, and admin with no userAccess doc
    await setDoc(doc(root, 'users', 'm4_admin_legacy'), {
      uid: 'm4_admin_legacy',
      role: 'admin',
      approved: true,
      email: 'm4_admin_legacy@example.com',
      displayName: 'Legacy Admin',
      createdAt: '2026-11-25',
    });
    await setDoc(doc(root, 'userAccess', 'm4_admin_legacy'), {
      status: 'active',
      scope: 'all',
      raceIds: [],
      overrides: {},
      permissions: { 'race.view': true },
    });
    await setDoc(doc(root, 'users', 'm4_admin_no_access'), {
      uid: 'm4_admin_no_access',
      role: 'admin',
      approved: true,
      email: 'm4_admin_no_access@example.com',
      displayName: 'No Access Doc Admin',
      createdAt: '2026-11-25',
    });

    // Removed accounts
    for (const removedUid of ['m4_removed_user', 'm4_sa_removed']) {
      await setDoc(doc(root, 'removedAccounts', removedUid), { uid: removedUid, removedAt: '2026-11-25T00:00:00Z' });
    }

    // Friendships (forward + reverse directions) & close friends & blocks
    await setDoc(doc(root, 'friendships', 'm4_author_m4_friend'), {
      fromUid: 'm4_author',
      toUid: 'm4_friend',
      members: ['m4_author', 'm4_friend'],
      createdAt: '2026-11-25',
    });
    await setDoc(doc(root, 'friendships', 'm4_author_m4_close_friend'), {
      fromUid: 'm4_author',
      toUid: 'm4_close_friend',
      members: ['m4_author', 'm4_close_friend'],
      createdAt: '2026-11-25',
    });
    await setDoc(doc(root, 'friendships', 'm4_commenter_m4_author'), {
      fromUid: 'm4_commenter',
      toUid: 'm4_author',
      members: ['m4_commenter', 'm4_author'],
      createdAt: '2026-11-25',
    });

    await setDoc(doc(root, 'closeFriendEdges', 'm4_author_m4_close_friend'), {
      id: 'm4_author_m4_close_friend',
      ownerUid: 'm4_author',
      targetUid: 'm4_close_friend',
      createdAt: '2026-11-25T00:00:00Z',
    });
    // Orphan close-friend edge (no friendship!) must NOT grant close_friends access
    await setDoc(doc(root, 'closeFriendEdges', 'm4_author_m4_stranger'), {
      id: 'm4_author_m4_stranger',
      ownerUid: 'm4_author',
      targetUid: 'm4_stranger',
      createdAt: '2026-11-25T00:00:00Z',
    });

    // Bidirectional blocks (author blocks + commenter blocks)
    await setDoc(doc(root, 'userBlocks', 'm4_author_m4_blocked_out'), {
      id: 'm4_author_m4_blocked_out',
      blockerUid: 'm4_author',
      blockedUid: 'm4_blocked_out',
      createdAt: '2026-11-25T00:00:00Z',
    });
    await setDoc(doc(root, 'userBlocks', 'm4_blocked_in_m4_author'), {
      id: 'm4_blocked_in_m4_author',
      blockerUid: 'm4_blocked_in',
      blockedUid: 'm4_author',
      createdAt: '2026-11-25T00:00:00Z',
    });
    await setDoc(doc(root, 'userBlocks', 'm4_commenter_m4_friend'), {
      id: 'm4_commenter_m4_friend',
      blockerUid: 'm4_commenter',
      blockedUid: 'm4_friend',
      createdAt: '2026-11-25T00:00:00Z',
    });

    // 1. publicProfiles
    await setDoc(doc(root, 'publicProfiles', 'm4_author'), {
      uid: 'm4_author',
      displayName: 'M4 Author',
      username: 'm4author',
      primaryClubId: 'club_open',
      primaryClubName: 'Open Run Club',
      updatedAt: '2026-11-25T00:00:00Z',
    });

    // 2. clubs + 3. clubMembers + 4. clubRequests + 5-7. meetups/announcements/spotlights
    await setDoc(doc(root, 'clubs', 'club_open'), {
      clubId: 'club_open',
      name: 'Open Run Club',
      status: 'active',
      joinPolicy: 'open',
      captainUids: ['m4_captain'],
      memberCount: 2,
    });
    await setDoc(doc(root, 'clubs', 'club_invite'), {
      clubId: 'club_invite',
      name: 'Invite Only Club',
      status: 'active',
      joinPolicy: 'invite_only',
      captainUids: ['m4_captain'],
      memberCount: 2,
    });
    await setDoc(doc(root, 'clubs', 'club_archived'), {
      clubId: 'club_archived',
      name: 'Archived Club',
      status: 'archived',
      joinPolicy: 'open',
      captainUids: ['m4_captain'],
      memberCount: 1,
    });
    await setDoc(doc(root, 'clubs', 'club_other'), {
      clubId: 'club_other',
      name: 'Other Club',
      status: 'active',
      joinPolicy: 'approval',
      captainUids: ['m4_author'],
      memberCount: 1,
    });
    await setDoc(doc(root, 'clubs', 'club_open_empty'), {
      clubId: 'club_open_empty',
      name: 'Open Club No Spotlight',
      status: 'active',
      joinPolicy: 'open',
      captainUids: ['m4_captain'],
      memberCount: 1,
    });
    await setDoc(doc(root, 'clubs', 'club_invite_empty'), {
      clubId: 'club_invite_empty',
      name: 'Invite Club No Spotlight',
      status: 'active',
      joinPolicy: 'invite_only',
      captainUids: ['m4_captain'],
      memberCount: 1,
    });

    await setDoc(doc(root, 'clubMembers', 'club_other_m4_club_pending'), {
      id: 'club_other_m4_club_pending',
      clubId: 'club_other',
      uid: 'm4_club_pending',
      role: 'member',
      status: 'pending',
      displayName: 'Pending Other',
      joinedAt: '2026-11-25T00:00:00Z',
    });

    await setDoc(doc(root, 'clubMembers', 'club_open_m4_captain'), {
      id: 'club_open_m4_captain',
      clubId: 'club_open',
      uid: 'm4_captain',
      role: 'captain',
      status: 'active',
      displayName: 'Captain',
      joinedAt: '2026-11-25T00:00:00Z',
    });
    await setDoc(doc(root, 'clubMembers', 'club_open_m4_club_member'), {
      id: 'club_open_m4_club_member',
      clubId: 'club_open',
      uid: 'm4_club_member',
      role: 'member',
      status: 'active',
      displayName: 'Member',
      joinedAt: '2026-11-25T00:00:00Z',
    });
    await setDoc(doc(root, 'clubMembers', 'club_open_m4_club_pending'), {
      id: 'club_open_m4_club_pending',
      clubId: 'club_open',
      uid: 'm4_club_pending',
      role: 'member',
      status: 'pending',
      displayName: 'Pending',
      joinedAt: '2026-11-25T00:00:00Z',
    });
    await setDoc(doc(root, 'clubMembers', 'club_invite_m4_club_member'), {
      id: 'club_invite_m4_club_member',
      clubId: 'club_invite',
      uid: 'm4_club_member',
      role: 'member',
      status: 'active',
      displayName: 'Member',
      joinedAt: '2026-11-25T00:00:00Z',
    });
    await setDoc(doc(root, 'clubMembers', 'club_invite_m4_club_pending'), {
      id: 'club_invite_m4_club_pending',
      clubId: 'club_invite',
      uid: 'm4_club_pending',
      role: 'member',
      status: 'pending',
      displayName: 'Pending Invite',
      joinedAt: '2026-11-25T00:00:00Z',
    });

    await setDoc(doc(root, 'clubRequests', 'creq_1'), {
      requestId: 'creq_1',
      requesterUid: 'm4_stranger',
      clubName: 'Makati Pacers',
      status: 'pending',
      createdAt: '2026-11-25T00:00:00Z',
    });

    for (const cid of ['club_open', 'club_invite', 'club_archived']) {
      await setDoc(doc(root, 'clubMeetups', `meetup_${cid}`), {
        meetupId: `meetup_${cid}`,
        clubId: cid,
        title: `Meetup ${cid}`,
        status: 'scheduled',
        startAtIso: '2026-12-01T05:30:00Z',
      });
      await setDoc(doc(root, 'clubAnnouncements', `ann_${cid}`), {
        announcementId: `ann_${cid}`,
        clubId: cid,
        title: `Notice ${cid}`,
        pinned: true,
        createdAt: '2026-11-25T00:00:00Z',
      });
      await setDoc(doc(root, 'clubSpotlights', cid), {
        clubId: cid,
        targetUid: 'm4_club_member',
        headline: `Star ${cid}`,
        featuredAt: '2026-11-25T00:00:00Z',
      });
    }

    // 8. socialPosts + 9. routeSnaps
    await setDoc(doc(root, 'socialPosts', 'post_public'), {
      postId: 'post_public',
      uid: 'm4_author',
      visibility: 'public',
      text: 'Morning tempo!',
      deletedAt: null,
      hiddenByModeration: false,
      createdAt: '2026-11-25T01:00:00Z',
    });
    await setDoc(doc(root, 'socialPosts', 'post_friends'), {
      postId: 'post_friends',
      uid: 'm4_author',
      visibility: 'friends',
      text: 'Friends pace run',
      deletedAt: null,
      hiddenByModeration: false,
      createdAt: '2026-11-25T02:00:00Z',
    });
    await setDoc(doc(root, 'socialPosts', 'post_cf'), {
      postId: 'post_cf',
      uid: 'm4_author',
      visibility: 'close_friends',
      text: 'Close circle secret route',
      deletedAt: null,
      hiddenByModeration: false,
      createdAt: '2026-11-25T03:00:00Z',
    });
    await setDoc(doc(root, 'socialPosts', 'post_hidden'), {
      postId: 'post_hidden',
      uid: 'm4_author',
      visibility: 'public',
      text: 'Flagged post',
      deletedAt: null,
      hiddenByModeration: true,
      createdAt: '2026-11-25T04:00:00Z',
    });
    await setDoc(doc(root, 'socialPosts', 'post_deleted'), {
      postId: 'post_deleted',
      uid: 'm4_author',
      visibility: 'public',
      text: 'Deleted post',
      deletedAt: '2026-11-25T05:00:00Z',
      hiddenByModeration: false,
      createdAt: '2026-11-25T05:00:00Z',
    });

    await setDoc(doc(root, 'routeSnaps', 'post_public'), {
      snapId: 'post_public',
      postId: 'post_public',
      uid: 'm4_author',
      visibility: 'public',
      deletedAt: null,
      hiddenByModeration: false,
      createdAt: '2026-11-25T01:00:00Z',
    });
    await setDoc(doc(root, 'routeSnaps', 'post_cf'), {
      snapId: 'post_cf',
      postId: 'post_cf',
      uid: 'm4_author',
      visibility: 'close_friends',
      deletedAt: null,
      hiddenByModeration: false,
      createdAt: '2026-11-25T03:00:00Z',
    });
    await setDoc(doc(root, 'routeSnaps', 'post_hidden'), {
      snapId: 'post_hidden',
      postId: 'post_hidden',
      uid: 'm4_author',
      visibility: 'public',
      deletedAt: null,
      hiddenByModeration: true,
      createdAt: '2026-11-25T04:00:00Z',
    });

    // 10. socialComments (including cross-author comment on close_friends post + multi-author comments on public post)
    await setDoc(doc(root, 'socialComments', 'cmt_pub_commenter'), {
      commentId: 'cmt_pub_commenter',
      postId: 'post_public',
      uid: 'm4_commenter',
      text: 'Nice pace!',
      deletedAt: null,
      hiddenByModeration: false,
      createdAt: '2026-11-25T01:10:00Z',
    });
    await setDoc(doc(root, 'socialComments', 'cmt_pub_friend'), {
      commentId: 'cmt_pub_friend',
      postId: 'post_public',
      uid: 'm4_friend',
      text: 'Strong finish!',
      deletedAt: null,
      hiddenByModeration: false,
      createdAt: '2026-11-25T01:15:00Z',
    });
    await setDoc(doc(root, 'socialComments', 'cmt_cf_commenter'), {
      commentId: 'cmt_cf_commenter',
      postId: 'post_cf',
      uid: 'm4_commenter',
      text: 'See you at 5am!',
      deletedAt: null,
      hiddenByModeration: false,
      createdAt: '2026-11-25T03:10:00Z',
    });
    await setDoc(doc(root, 'socialComments', 'cmt_hidden'), {
      commentId: 'cmt_hidden',
      postId: 'post_public',
      uid: 'm4_commenter',
      text: 'Hidden comment',
      deletedAt: null,
      hiddenByModeration: true,
      createdAt: '2026-11-25T01:20:00Z',
    });
    await setDoc(doc(root, 'socialComments', 'cmt_deleted'), {
      commentId: 'cmt_deleted',
      postId: 'post_public',
      uid: 'm4_commenter',
      text: 'Deleted comment',
      deletedAt: '2026-11-25T01:25:00Z',
      hiddenByModeration: false,
      createdAt: '2026-11-25T01:25:00Z',
    });
    await setDoc(doc(root, 'socialComments', 'cmt_orphan'), {
      commentId: 'cmt_orphan',
      postId: 'post_missing',
      uid: 'm4_commenter',
      text: 'Orphaned comment',
      deletedAt: null,
      hiddenByModeration: false,
      createdAt: '2026-11-25T01:30:00Z',
    });

    // 11. socialKudos
    await setDoc(doc(root, 'socialKudos', 'post_public_m4_friend'), {
      id: 'post_public_m4_friend',
      postId: 'post_public',
      uid: 'm4_friend',
      recipientUid: 'm4_author',
      createdAt: '2026-11-25T01:05:00Z',
    });

    // 14. contentReports
    await setDoc(doc(root, 'contentReports', 'rep_1'), {
      reportId: 'rep_1',
      reporterUid: 'm4_friend',
      targetType: 'post',
      targetId: 'post_public',
      targetUid: 'm4_author',
      reason: 'spam',
      status: 'open',
      createdAt: '2026-11-25T01:40:00Z',
    });

    // 15. conversations + 16. messages + 17. friendStreaks
    await setDoc(doc(root, 'conversations', 'dm_m4_author_m4_friend'), {
      conversationId: 'dm_m4_author_m4_friend',
      type: 'dm',
      members: ['m4_author', 'm4_friend'],
      status: 'active',
      updatedAt: '2026-11-25T02:00:00Z',
    });
    await setDoc(doc(root, 'conversations', longDmConvId), {
      conversationId: longDmConvId,
      type: 'dm',
      members: [longDmA, longDmB],
      status: 'active',
      updatedAt: '2026-11-25T02:00:00Z',
    });
    await setDoc(doc(root, 'conversations', 'club_club_open'), {
      conversationId: 'club_club_open',
      type: 'club',
      clubId: 'club_open',
      members: [],
      status: 'active',
      updatedAt: '2026-11-25T02:00:00Z',
    });

    await setDoc(doc(root, 'conversations', 'dm_m4_author_m4_friend', 'messages', 'msg_1'), {
      messageId: 'msg_1',
      conversationId: 'dm_m4_author_m4_friend',
      senderUid: 'm4_author',
      text: 'Morning!',
      deletedAt: null,
      hiddenByModeration: false,
      createdAt: '2026-11-25T02:00:00Z',
    });
    await setDoc(doc(root, 'conversations', 'dm_m4_author_m4_friend', 'messages', 'msg_2_del'), {
      messageId: 'msg_2_del',
      conversationId: 'dm_m4_author_m4_friend',
      senderUid: 'm4_friend',
      text: 'Removed msg',
      deletedAt: '2026-11-25T02:05:00Z',
      hiddenByModeration: true,
      createdAt: '2026-11-25T02:05:00Z',
    });
    await setDoc(doc(root, 'conversations', longDmConvId, 'messages', 'msg_long'), {
      messageId: 'msg_long',
      conversationId: longDmConvId,
      senderUid: longDmA,
      text: 'Long conv ID message',
      deletedAt: null,
      hiddenByModeration: false,
      createdAt: '2026-11-25T02:00:00Z',
    });
    await setDoc(doc(root, 'conversations', 'club_club_open', 'messages', 'msg_club_1'), {
      messageId: 'msg_club_1',
      conversationId: 'club_club_open',
      senderUid: 'm4_club_member',
      text: 'Long run Sunday!',
      deletedAt: null,
      hiddenByModeration: false,
      createdAt: '2026-11-25T02:00:00Z',
    });
    await setDoc(doc(root, 'conversations', 'dm_missing_conv', 'messages', 'msg_orphan'), {
      messageId: 'msg_orphan',
      conversationId: 'dm_missing_conv',
      senderUid: 'm4_author',
      text: 'Orphan',
      deletedAt: null,
      hiddenByModeration: false,
      createdAt: '2026-11-25T02:00:00Z',
    });

    await setDoc(doc(root, 'friendStreaks', 'dm_m4_author_m4_friend'), {
      id: 'dm_m4_author_m4_friend',
      members: ['m4_author', 'm4_friend'],
      streakDays: 4,
      updatedAt: '2026-11-25T02:00:00Z',
    });

    // 18. activityNotifications
    await setDoc(doc(root, 'activityNotifications', 'noti_1'), {
      id: 'noti_1',
      uid: 'm4_author',
      kind: 'kudos',
      actorUid: 'm4_friend',
      targetId: 'post_public',
      summary: 'Friend gave kudos.',
      read: false,
      createdAt: '2026-11-25T02:00:00Z',
    });

    // 19. userPushTokens
    await setDoc(doc(root, 'userPushTokens', 'm4_author_tok1'), {
      id: 'm4_author_tok1',
      uid: 'm4_author',
      token: 'fcm_secret_token_123456',
      platform: 'android',
      updatedAt: '2026-11-25T02:00:00Z',
    });
  });

  const anonDb = env.unauthenticatedContext().firestore();
  const unverifiedNoDocDb = env.authenticatedContext('m4_unverified_no_doc', { email: 'unv@example.com', email_verified: false }).firestore();
  const unverifiedCloseFriendDb = env.authenticatedContext('m4_close_friend', { email: 'm4_close_friend@example.com', email_verified: false }).firestore();

  // Baseline auth & removed account barriers across M4 collections
  for (const [colName, docId] of [
    ['publicProfiles', 'm4_author'],
    ['clubs', 'club_open'],
    ['clubMembers', 'club_open_m4_club_member'],
    ['clubRequests', 'creq_1'],
    ['clubMeetups', 'meetup_club_open'],
    ['clubAnnouncements', 'ann_club_open'],
    ['clubSpotlights', 'club_open'],
    ['socialPosts', 'post_public'],
    ['routeSnaps', 'post_public'],
    ['socialComments', 'cmt_pub_commenter'],
    ['socialKudos', 'post_public_m4_friend'],
    ['closeFriendEdges', 'm4_author_m4_close_friend'],
    ['userBlocks', 'm4_author_m4_blocked_out'],
    ['contentReports', 'rep_1'],
    ['conversations', 'dm_m4_author_m4_friend'],
    ['friendStreaks', 'dm_m4_author_m4_friend'],
    ['activityNotifications', 'noti_1'],
    ['userPushTokens', 'm4_author_tok1'],
  ]) {
    await assertFails(getDoc(doc(anonDb, colName, docId)));
    await assertFails(getDoc(doc(unverifiedNoDocDb, colName, docId)));
    await assertFails(getDoc(doc(db('m4_removed_user'), colName, docId)));
    await assertFails(getDoc(doc(db('m4_sa_removed'), colName, docId)));
  }
  await assertFails(getDoc(doc(anonDb, 'conversations', 'dm_m4_author_m4_friend', 'messages', 'msg_1')));
  await assertFails(getDoc(doc(db('m4_removed_user'), 'conversations', 'dm_m4_author_m4_friend', 'messages', 'msg_1')));
  await assertFails(getDoc(doc(db('m4_sa_removed'), 'conversations', 'dm_m4_author_m4_friend', 'messages', 'msg_1')));

  // 1. publicProfiles
  await assertSucceeds(getDoc(doc(db('m4_stranger'), 'publicProfiles', 'm4_author')));
  await assertSucceeds(getDocs(collection(db('m4_stranger'), 'publicProfiles')));

  // 2. clubs
  await assertSucceeds(getDoc(doc(db('m4_stranger'), 'clubs', 'club_open')));
  await assertSucceeds(getDocs(query(collection(db('m4_stranger'), 'clubs'), where('status', '==', 'active'), orderBy('memberCount', 'desc'))));
  await assertFails(getDoc(doc(db('m4_stranger'), 'clubs', 'club_archived')));
  await assertFails(getDoc(doc(db('m4_org_default'), 'clubs', 'club_archived')));
  await assertFails(getDoc(doc(db('m4_org_unapproved_granted'), 'clubs', 'club_archived')));
  await assertFails(getDoc(doc(db('m4_admin_revoked'), 'clubs', 'club_archived')));
  await assertFails(getDoc(doc(db('m4_admin_suspended'), 'clubs', 'club_archived')));
  await assertFails(getDoc(doc(db('m4_sa_suspended'), 'clubs', 'club_archived')));
  for (const uid of ['m4_org_clubs', 'm4_admin_default', 'm4_admin_legacy', 'm4_admin_no_access', 'm4_sa_active']) {
    await assertSucceeds(getDoc(doc(db(uid), 'clubs', 'club_archived')));
    await assertSucceeds(getDocs(collection(db(uid), 'clubs')));
  }

  // 3. clubMembers (self pending/active, active directory, pending restricted to captain/clubs.view/superadmin)
  await assertSucceeds(getDoc(doc(db('m4_club_pending'), 'clubMembers', 'club_open_m4_club_pending')));
  await assertSucceeds(getDocs(query(collection(db('m4_club_pending'), 'clubMembers'), where('uid', '==', 'm4_club_pending'))));
  await assertSucceeds(getDocs(query(collection(db('m4_stranger'), 'clubMembers'), where('clubId', '==', 'club_open'), where('status', '==', 'active'), orderBy('joinedAt', 'desc'))));
  await assertSucceeds(getDoc(doc(db('m4_stranger'), 'clubMembers', 'club_open_m4_club_member')));
  await assertFails(getDoc(doc(db('m4_stranger'), 'clubMembers', 'club_open_m4_club_pending')));
  await assertFails(getDoc(doc(db('m4_club_member'), 'clubMembers', 'club_open_m4_club_pending')));
  await assertFails(getDoc(doc(db('m4_org_default'), 'clubMembers', 'club_open_m4_club_pending')));
  await assertFails(getDoc(doc(db('m4_admin_revoked'), 'clubMembers', 'club_open_m4_club_pending')));
  await assertFails(getDoc(doc(db('m4_captain'), 'clubMembers', 'club_other_m4_club_pending')));
  await assertSucceeds(getDoc(doc(db('m4_captain'), 'clubMembers', 'club_open_m4_club_pending')));
  await assertSucceeds(getDoc(doc(db('m4_org_clubs'), 'clubMembers', 'club_open_m4_club_pending')));
  await assertSucceeds(getDoc(doc(db('m4_admin_default'), 'clubMembers', 'club_open_m4_club_pending')));
  await assertSucceeds(getDoc(doc(db('m4_admin_no_access'), 'clubMembers', 'club_open_m4_club_pending')));
  await assertSucceeds(getDoc(doc(db('m4_sa_active'), 'clubMembers', 'club_open_m4_club_pending')));

  // 4. clubRequests
  await assertSucceeds(getDoc(doc(db('m4_stranger'), 'clubRequests', 'creq_1')));
  await assertSucceeds(getDocs(query(collection(db('m4_stranger'), 'clubRequests'), where('requesterUid', '==', 'm4_stranger'), where('status', '==', 'pending'))));
  await assertFails(getDoc(doc(db('m4_author'), 'clubRequests', 'creq_1')));
  await assertFails(getDoc(doc(db('m4_captain'), 'clubRequests', 'creq_1')));
  await assertFails(getDoc(doc(db('m4_org_default'), 'clubRequests', 'creq_1')));
  await assertFails(getDoc(doc(db('m4_admin_revoked'), 'clubRequests', 'creq_1')));
  await assertFails(getDoc(doc(db('m4_admin_suspended'), 'clubRequests', 'creq_1')));
  await assertSucceeds(getDoc(doc(db('m4_org_clubs'), 'clubRequests', 'creq_1')));
  await assertSucceeds(getDocs(query(collection(db('m4_admin_default'), 'clubRequests'), where('status', '==', 'pending'), orderBy('createdAt', 'desc'))));
  await assertSucceeds(getDoc(doc(db('m4_sa_active'), 'clubRequests', 'creq_1')));

  // 5-7. clubMeetups, clubAnnouncements, clubSpotlights
  for (const [colName, openId, inviteId, archivedId] of [
    ['clubMeetups', 'meetup_club_open', 'meetup_club_invite', 'meetup_club_archived'],
    ['clubAnnouncements', 'ann_club_open', 'ann_club_invite', 'ann_club_archived'],
    ['clubSpotlights', 'club_open', 'club_invite', 'club_archived'],
  ]) {
    await assertSucceeds(getDoc(doc(db('m4_stranger'), colName, openId)));
    await assertSucceeds(getDocs(query(collection(db('m4_stranger'), colName), where('clubId', '==', 'club_open'))));
    await assertFails(getDoc(doc(db('m4_stranger'), colName, inviteId)));
    await assertFails(getDoc(doc(db('m4_club_pending'), colName, inviteId)));
    await assertSucceeds(getDoc(doc(db('m4_club_member'), colName, inviteId)));
    await assertFails(getDoc(doc(db('m4_stranger'), colName, archivedId)));
    await assertFails(getDoc(doc(db('m4_admin_revoked'), colName, archivedId)));
    await assertSucceeds(getDoc(doc(db('m4_org_clubs'), colName, archivedId)));
    await assertSucceeds(getDoc(doc(db('m4_admin_default'), colName, archivedId)));
    await assertSucceeds(getDoc(doc(db('m4_sa_active'), colName, archivedId)));
  }
  // Missing clubSpotlights doc returns cleanly on open club but rejects invite-only club
  await assertSucceeds(getDoc(doc(db('m4_stranger'), 'clubSpotlights', 'club_open_empty')));
  await assertFails(getDoc(doc(db('m4_stranger'), 'clubSpotlights', 'club_invite_empty')));

  // 8-9. socialPosts & routeSnaps
  await assertSucceeds(getDocs(query(collection(db('m4_author'), 'socialPosts'), where('uid', '==', 'm4_author'), orderBy('createdAt', 'desc'))));
  for (const colName of ['socialPosts', 'routeSnaps']) {
    await assertSucceeds(getDoc(doc(db('m4_author'), colName, 'post_public')));
    await assertSucceeds(getDoc(doc(db('m4_author'), colName, 'post_cf')));
    await assertSucceeds(getDoc(doc(db('m4_author'), colName, 'post_hidden')));

    await assertSucceeds(getDoc(doc(db('m4_stranger'), colName, 'post_public')));
    await assertFails(getDoc(doc(db('m4_stranger'), colName, 'post_cf'))); // orphan closeFriendEdge without friendship must fail
    await assertFails(getDoc(doc(db('m4_stranger'), colName, 'post_hidden')));

    await assertSucceeds(getDoc(doc(db('m4_friend'), colName, 'post_public')));
    await assertFails(getDoc(doc(db('m4_friend'), colName, 'post_cf')));

    await assertSucceeds(getDoc(doc(db('m4_close_friend'), colName, 'post_cf')));

    // Bidirectional blocks hide even public posts
    await assertFails(getDoc(doc(db('m4_blocked_out'), colName, 'post_public')));
    await assertFails(getDoc(doc(db('m4_blocked_in'), colName, 'post_public')));

    // Moderation & SuperAdmin visibility
    await assertFails(getDoc(doc(db('m4_admin_revoked'), colName, 'post_hidden')));
    await assertFails(getDoc(doc(db('m4_admin_suspended'), colName, 'post_hidden')));
    await assertFails(getDoc(doc(db('m4_sa_suspended'), colName, 'post_hidden')));
    await assertFails(getDoc(doc(db('m4_org_unapproved_granted'), colName, 'post_hidden')));
    await assertSucceeds(getDoc(doc(db('m4_org_mod'), colName, 'post_hidden')));
    await assertSucceeds(getDoc(doc(db('m4_admin_default'), colName, 'post_cf')));
    await assertSucceeds(getDoc(doc(db('m4_admin_legacy'), colName, 'post_hidden')));
    await assertSucceeds(getDoc(doc(db('m4_sa_active'), colName, 'post_hidden')));
  }
  await assertSucceeds(getDoc(doc(db('m4_friend'), 'socialPosts', 'post_friends')));
  await assertFails(getDoc(doc(db('m4_stranger'), 'socialPosts', 'post_friends')));
  await assertFails(getDoc(doc(db('m4_friend'), 'socialPosts', 'post_deleted')));
  await assertSucceeds(getDoc(doc(db('m4_author'), 'socialPosts', 'post_deleted')));
  await assertSucceeds(getDoc(doc(db('m4_sa_active'), 'socialPosts', 'post_deleted')));

  // 10. socialComments (including 3-party close_friends comment & block isolation & list queries)
  await assertSucceeds(getDoc(doc(db('m4_commenter'), 'socialComments', 'cmt_hidden')));
  await assertSucceeds(getDocs(query(collection(db('m4_commenter'), 'socialComments'), where('uid', '==', 'm4_commenter'))));
  await assertSucceeds(getDoc(doc(db('m4_stranger'), 'socialComments', 'cmt_pub_commenter')));
  await assertSucceeds(getDoc(doc(db('m4_author'), 'socialComments', 'cmt_cf_commenter')));
  await assertSucceeds(getDoc(doc(db('m4_close_friend'), 'socialComments', 'cmt_cf_commenter')));
  await assertSucceeds(getDoc(doc(unverifiedCloseFriendDb, 'socialComments', 'cmt_cf_commenter')));
  await assertFails(getDoc(doc(db('m4_friend'), 'socialComments', 'cmt_cf_commenter')));
  await assertFails(getDoc(doc(db('m4_friend'), 'socialComments', 'cmt_pub_commenter'))); // blocked by commenter m4_commenter
  await assertFails(getDoc(doc(db('m4_stranger'), 'socialComments', 'cmt_cf_commenter')));
  await assertFails(getDoc(doc(db('m4_stranger'), 'socialComments', 'cmt_hidden')));
  await assertFails(getDoc(doc(db('m4_stranger'), 'socialComments', 'cmt_deleted')));
  await assertFails(getDoc(doc(db('m4_stranger'), 'socialComments', 'cmt_orphan')));
  await assertFails(getDoc(doc(db('m4_blocked_out'), 'socialComments', 'cmt_pub_commenter')));
  await assertFails(getDoc(doc(db('m4_blocked_in'), 'socialComments', 'cmt_pub_commenter')));
  await assertFails(getDoc(doc(db('m4_admin_revoked'), 'socialComments', 'cmt_hidden')));
  await assertFails(getDoc(doc(db('m4_sa_suspended'), 'socialComments', 'cmt_hidden')));
  await assertSucceeds(getDoc(doc(db('m4_org_mod'), 'socialComments', 'cmt_hidden')));
  await assertSucceeds(getDoc(doc(db('m4_admin_default'), 'socialComments', 'cmt_hidden')));
  await assertSucceeds(getDoc(doc(db('m4_admin_default'), 'socialComments', 'cmt_cf_commenter')));
  await assertSucceeds(getDoc(doc(db('m4_admin_no_access'), 'socialComments', 'cmt_hidden')));
  await assertSucceeds(getDoc(doc(db('m4_sa_active'), 'socialComments', 'cmt_deleted')));
  await assertSucceeds(getDocs(query(collection(db('m4_sa_active'), 'socialComments'), where('postId', '==', 'post_public'), orderBy('createdAt', 'asc'))));

  // 11. socialKudos
  await assertSucceeds(getDoc(doc(db('m4_friend'), 'socialKudos', 'post_public_m4_friend')));
  await assertSucceeds(getDoc(doc(db('m4_author'), 'socialKudos', 'post_public_m4_friend')));
  await assertSucceeds(getDocs(query(collection(db('m4_author'), 'socialKudos'), where('recipientUid', '==', 'm4_author'))));
  await assertFails(getDoc(doc(db('m4_stranger'), 'socialKudos', 'post_public_m4_friend')));
  await assertFails(getDoc(doc(db('m4_admin_revoked'), 'socialKudos', 'post_public_m4_friend')));
  await assertSucceeds(getDoc(doc(db('m4_org_mod'), 'socialKudos', 'post_public_m4_friend')));
  await assertSucceeds(getDoc(doc(db('m4_sa_active'), 'socialKudos', 'post_public_m4_friend')));

  // 12. closeFriendEdges (owner + active superadmin ONLY; targetUid & non-SA admins denied!)
  await assertSucceeds(getDoc(doc(db('m4_author'), 'closeFriendEdges', 'm4_author_m4_close_friend')));
  await assertSucceeds(getDocs(query(collection(db('m4_author'), 'closeFriendEdges'), where('ownerUid', '==', 'm4_author'))));
  await assertFails(getDoc(doc(db('m4_close_friend'), 'closeFriendEdges', 'm4_author_m4_close_friend')));
  await assertFails(getDoc(doc(db('m4_stranger'), 'closeFriendEdges', 'm4_author_m4_close_friend')));
  await assertFails(getDoc(doc(db('m4_org_default'), 'closeFriendEdges', 'm4_author_m4_close_friend')));
  await assertFails(getDoc(doc(db('m4_admin_default'), 'closeFriendEdges', 'm4_author_m4_close_friend')));
  await assertFails(getDoc(doc(db('m4_org_mod'), 'closeFriendEdges', 'm4_author_m4_close_friend')));
  await assertFails(getDoc(doc(db('m4_sa_suspended'), 'closeFriendEdges', 'm4_author_m4_close_friend')));
  await assertSucceeds(getDoc(doc(db('m4_sa_active'), 'closeFriendEdges', 'm4_author_m4_close_friend')));

  // 13. userBlocks (blocker + moderation.manage + active superadmin ONLY; blockedUid denied!)
  await assertSucceeds(getDoc(doc(db('m4_author'), 'userBlocks', 'm4_author_m4_blocked_out')));
  await assertSucceeds(getDocs(query(collection(db('m4_author'), 'userBlocks'), where('blockerUid', '==', 'm4_author'))));
  await assertFails(getDoc(doc(db('m4_blocked_out'), 'userBlocks', 'm4_author_m4_blocked_out')));
  await assertFails(getDoc(doc(db('m4_stranger'), 'userBlocks', 'm4_author_m4_blocked_out')));
  await assertFails(getDoc(doc(db('m4_admin_revoked'), 'userBlocks', 'm4_author_m4_blocked_out')));
  await assertFails(getDoc(doc(db('m4_sa_suspended'), 'userBlocks', 'm4_author_m4_blocked_out')));
  await assertSucceeds(getDoc(doc(db('m4_org_mod'), 'userBlocks', 'm4_author_m4_blocked_out')));
  await assertSucceeds(getDoc(doc(db('m4_sa_active'), 'userBlocks', 'm4_author_m4_blocked_out')));

  // 14. contentReports (reporter + moderation.manage + active superadmin ONLY; targetUid denied!)
  await assertSucceeds(getDoc(doc(db('m4_friend'), 'contentReports', 'rep_1')));
  await assertSucceeds(getDocs(query(collection(db('m4_friend'), 'contentReports'), where('reporterUid', '==', 'm4_friend'))));
  await assertFails(getDoc(doc(db('m4_author'), 'contentReports', 'rep_1')));
  await assertFails(getDoc(doc(db('m4_stranger'), 'contentReports', 'rep_1')));
  await assertFails(getDoc(doc(db('m4_admin_revoked'), 'contentReports', 'rep_1')));
  await assertSucceeds(getDoc(doc(db('m4_org_mod'), 'contentReports', 'rep_1')));
  await assertSucceeds(getDocs(query(collection(db('m4_admin_default'), 'contentReports'), where('status', '==', 'open'), orderBy('createdAt', 'desc'))));
  await assertSucceeds(getDoc(doc(db('m4_sa_active'), 'contentReports', 'rep_1')));

  // 15. conversations + 16. messages
  await assertSucceeds(getDoc(doc(db('m4_author'), 'conversations', 'dm_m4_author_m4_friend')));
  await assertSucceeds(getDocs(query(collection(db('m4_author'), 'conversations'), where('members', 'array-contains', 'm4_author'), orderBy('updatedAt', 'desc'))));
  await assertFails(getDoc(doc(db('m4_stranger'), 'conversations', 'dm_m4_author_m4_friend')));
  await assertSucceeds(getDoc(doc(db('m4_club_member'), 'conversations', 'club_club_open')));
  await assertFails(getDoc(doc(db('m4_club_pending'), 'conversations', 'club_club_open')));
  await assertFails(getDoc(doc(db('m4_stranger'), 'conversations', 'club_club_open')));
  await assertSucceeds(getDoc(doc(db('m4_org_mod'), 'conversations', 'dm_m4_author_m4_friend')));
  await assertSucceeds(getDoc(doc(db('m4_sa_active'), 'conversations', 'club_club_open')));

  await assertSucceeds(getDoc(doc(db('m4_author'), 'conversations', 'dm_m4_author_m4_friend', 'messages', 'msg_1')));
  await assertSucceeds(getDocs(collection(db('m4_friend'), 'conversations', 'dm_m4_author_m4_friend', 'messages')));
  await assertSucceeds(getDoc(doc(db(longDmA), 'conversations', longDmConvId, 'messages', 'msg_long')));
  await assertFails(getDoc(doc(db('m4_stranger'), 'conversations', 'dm_m4_author_m4_friend', 'messages', 'msg_1')));
  await assertFails(getDocs(collection(db('m4_stranger'), 'conversations', 'dm_m4_author_m4_friend', 'messages')));
  await assertSucceeds(getDoc(doc(db('m4_club_member'), 'conversations', 'club_club_open', 'messages', 'msg_club_1')));
  await assertSucceeds(getDocs(collection(db('m4_club_member'), 'conversations', 'club_club_open', 'messages')));
  await assertFails(getDoc(doc(db('m4_club_pending'), 'conversations', 'club_club_open', 'messages', 'msg_club_1')));
  await assertFails(getDoc(doc(db('m4_stranger'), 'conversations', 'club_club_open', 'messages', 'msg_club_1')));
  await assertFails(getDoc(doc(db('m4_author'), 'conversations', 'dm_missing_conv', 'messages', 'msg_orphan')));
  await assertFails(getDoc(doc(db('m4_admin_revoked'), 'conversations', 'dm_m4_author_m4_friend', 'messages', 'msg_1')));
  await assertSucceeds(getDoc(doc(db('m4_org_mod'), 'conversations', 'dm_m4_author_m4_friend', 'messages', 'msg_2_del')));
  await assertSucceeds(getDoc(doc(db('m4_sa_active'), 'conversations', 'club_club_open', 'messages', 'msg_club_1')));

  // 17. friendStreaks (members + active superadmin ONLY)
  await assertSucceeds(getDoc(doc(db('m4_author'), 'friendStreaks', 'dm_m4_author_m4_friend')));
  await assertSucceeds(getDocs(query(collection(db('m4_friend'), 'friendStreaks'), where('members', 'array-contains', 'm4_friend'))));
  await assertFails(getDoc(doc(db('m4_stranger'), 'friendStreaks', 'dm_m4_author_m4_friend')));
  await assertFails(getDoc(doc(db('m4_org_default'), 'friendStreaks', 'dm_m4_author_m4_friend')));
  await assertFails(getDoc(doc(db('m4_admin_default'), 'friendStreaks', 'dm_m4_author_m4_friend')));
  await assertFails(getDoc(doc(db('m4_sa_suspended'), 'friendStreaks', 'dm_m4_author_m4_friend')));
  await assertSucceeds(getDoc(doc(db('m4_sa_active'), 'friendStreaks', 'dm_m4_author_m4_friend')));

  // 18. activityNotifications (recipient + active superadmin ONLY)
  await assertSucceeds(getDoc(doc(db('m4_author'), 'activityNotifications', 'noti_1')));
  await assertSucceeds(getDocs(query(collection(db('m4_author'), 'activityNotifications'), where('uid', '==', 'm4_author'), orderBy('createdAt', 'desc'))));
  await assertFails(getDoc(doc(db('m4_friend'), 'activityNotifications', 'noti_1')));
  await assertFails(getDoc(doc(db('m4_org_default'), 'activityNotifications', 'noti_1')));
  await assertFails(getDoc(doc(db('m4_admin_default'), 'activityNotifications', 'noti_1')));
  await assertFails(getDoc(doc(db('m4_sa_suspended'), 'activityNotifications', 'noti_1')));
  await assertSucceeds(getDoc(doc(db('m4_sa_active'), 'activityNotifications', 'noti_1')));

  // 19. userPushTokens (owner + active superadmin ONLY)
  await assertSucceeds(getDoc(doc(db('m4_author'), 'userPushTokens', 'm4_author_tok1')));
  await assertSucceeds(getDocs(query(collection(db('m4_author'), 'userPushTokens'), where('uid', '==', 'm4_author'))));
  await assertFails(getDoc(doc(db('m4_stranger'), 'userPushTokens', 'm4_author_tok1')));
  await assertFails(getDoc(doc(db('m4_org_default'), 'userPushTokens', 'm4_author_tok1')));
  await assertFails(getDoc(doc(db('m4_admin_default'), 'userPushTokens', 'm4_author_tok1')));
  await assertFails(getDoc(doc(db('m4_sa_suspended'), 'userPushTokens', 'm4_author_tok1')));
  await assertSucceeds(getDoc(doc(db('m4_sa_active'), 'userPushTokens', 'm4_author_tok1')));

  // Client writes MUST be denied across ALL 19 M4 collections/subcollections (even for owner & active Super Admin)
  const writePayloads = [
    ['publicProfiles', 'm4_author', { uid: 'm4_author', displayName: 'Tampered' }],
    ['clubs', 'club_forged', { clubId: 'club_forged', name: 'Forged', status: 'active' }],
    ['clubMembers', 'club_open_m4_stranger', { clubId: 'club_open', uid: 'm4_stranger', status: 'active' }],
    ['clubRequests', 'creq_forged', { requestId: 'creq_forged', requesterUid: 'm4_stranger', status: 'approved' }],
    ['clubMeetups', 'meetup_forged', { meetupId: 'meetup_forged', clubId: 'club_open', title: 'Forged' }],
    ['clubAnnouncements', 'ann_forged', { announcementId: 'ann_forged', clubId: 'club_open', title: 'Forged' }],
    ['clubSpotlights', 'club_open', { clubId: 'club_open', targetUid: 'm4_stranger', headline: 'Forged' }],
    ['socialPosts', 'post_forged', { postId: 'post_forged', uid: 'm4_author', visibility: 'public', text: 'Forged' }],
    ['routeSnaps', 'snap_forged', { snapId: 'snap_forged', uid: 'm4_author', visibility: 'public' }],
    ['socialComments', 'cmt_forged', { commentId: 'cmt_forged', postId: 'post_public', uid: 'm4_author', text: 'Forged' }],
    ['socialKudos', 'post_public_m4_author', { id: 'post_public_m4_author', postId: 'post_public', uid: 'm4_author' }],
    ['closeFriendEdges', 'm4_author_m4_stranger_forged', { ownerUid: 'm4_author', targetUid: 'm4_stranger' }],
    ['userBlocks', 'm4_author_m4_stranger_forged', { blockerUid: 'm4_author', blockedUid: 'm4_stranger' }],
    ['contentReports', 'rep_forged', { reportId: 'rep_forged', reporterUid: 'm4_author', status: 'dismissed' }],
    ['conversations', 'dm_m4_author_m4_stranger', { conversationId: 'dm_m4_author_m4_stranger', type: 'dm', members: ['m4_author', 'm4_stranger'] }],
    ['friendStreaks', 'dm_m4_author_m4_friend', { id: 'dm_m4_author_m4_friend', members: ['m4_author', 'm4_friend'], streakDays: 999 }],
    ['activityNotifications', 'noti_forged', { id: 'noti_forged', uid: 'm4_author', read: true }],
    ['userPushTokens', 'm4_author_tok_forged', { id: 'm4_author_tok_forged', uid: 'm4_author', token: 'forged' }],
  ];
  for (const writerUid of ['m4_author', 'm4_captain', 'm4_admin_default', 'm4_sa_active']) {
    for (const [colName, docId, payload] of writePayloads) {
      await assertFails(setDoc(doc(db(writerUid), colName, docId), payload));
    }
    await assertFails(updateDoc(doc(db(writerUid), 'clubs', 'club_open'), { name: 'Hijacked' }));
    await assertFails(deleteDoc(doc(db(writerUid), 'socialPosts', 'post_public')));
    await assertFails(updateDoc(doc(db(writerUid), 'activityNotifications', 'noti_1'), { read: true }));
    await assertFails(setDoc(doc(db(writerUid), 'conversations', 'dm_m4_author_m4_friend', 'messages', 'msg_forged'), { messageId: 'msg_forged', senderUid: writerUid, text: 'Forged' }));
    await assertFails(updateDoc(doc(db(writerUid), 'conversations', 'dm_m4_author_m4_friend', 'messages', 'msg_1'), { text: 'Edited' }));
    await assertFails(deleteDoc(doc(db(writerUid), 'conversations', 'dm_m4_author_m4_friend', 'messages', 'msg_1')));
  }
});

