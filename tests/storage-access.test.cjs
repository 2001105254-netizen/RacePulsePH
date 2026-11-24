const {test,before,after}=require('node:test');
const fs=require('node:fs');
const {initializeTestEnvironment,assertSucceeds,assertFails}=require('@firebase/rules-unit-testing');
const {doc,setDoc}=require('firebase/firestore');
const {ref,uploadBytes,deleteObject,getBytes}=require('firebase/storage');
let env;
before(async()=>{
 env=await initializeTestEnvironment({projectId:'demo-racepulse-rbac',firestore:{host:'127.0.0.1',port:8080},storage:{host:'127.0.0.1',port:9199,rules:fs.readFileSync('storage.rules','utf8')}});
 await env.withSecurityRulesDisabled(async ctx=>{
  await setDoc(doc(ctx.firestore(),'users','storage_owner'),{uid:'storage_owner',role:'organizer',approved:true});
  await setDoc(doc(ctx.firestore(),'users','storage_superadmin'),{uid:'storage_superadmin',role:'superadmin',approved:true});
  await setDoc(doc(ctx.firestore(),'races','storage_race'),{createdBy:'storage_owner'});
  await setDoc(doc(ctx.firestore(),'races','unassigned_storage_race'),{createdBy:'other'});
  await setDoc(doc(ctx.firestore(),'publishedRaceRoutes','pub_storage_1'),{id:'pub_storage_1',status:'published',raceId:'storage_race'});
  await setDoc(doc(ctx.firestore(),'publishedRaceRoutes','pub_storage_other'),{id:'pub_storage_other',status:'published',raceId:'unassigned_storage_race'});
  // This intentionally stale scope mirrors an account promoted to Super Admin.
  await setDoc(doc(ctx.firestore(),'userAccess','storage_superadmin'),{status:'active',scope:'selected',raceIds:[],overrides:{'race.artwork':false,'race.view':false}});
 });
});
after(async()=>env?.cleanup());
const image=new Uint8Array([137,80,78,71]);
const upload=(ctx,race,name='poster-test.jpg',folder='storage_owner')=>uploadBytes(ref(ctx.storage(),`race-assets/${folder}/${race}/${name}`),image,{contentType:'image/png'});
test('race artwork requires authenticated owner and assigned race',async()=>{
 await assertFails(upload(env.unauthenticatedContext(),'storage_race'));
 await assertSucceeds(upload(env.authenticatedContext('storage_owner'),'storage_race'));
 await assertFails(upload(env.authenticatedContext('storage_owner'),'unassigned_storage_race'));
 await assertFails(upload(env.authenticatedContext('storage_owner'),'storage_race','poster-test.jpg','someone_else'));
});
test('an artwork denial also blocks direct upload requests',async()=>{
 await env.withSecurityRulesDisabled(ctx=>setDoc(doc(ctx.firestore(),'userAccess','storage_owner'),{status:'active',scope:'owned-assigned',raceIds:[],overrides:{'race.artwork':false}}));
 await assertFails(upload(env.authenticatedContext('storage_owner'),'storage_race','poster-denied.jpg'));
 await assertSucceeds(upload(env.authenticatedContext('storage_owner'),'storage_race','bib-allowed.jpg'));
});
test('Super Admin can upload artwork for any race despite a legacy restricted scope',async()=>{
 await assertSucceeds(upload(env.authenticatedContext('storage_superadmin'),'unassigned_storage_race','poster-superadmin.jpg','storage_superadmin'));
});
test('platform owner email can recover Storage uploads only with a verified email claim',async()=>{
 await assertFails(upload(env.authenticatedContext('storage_owner_email',{email:'kiahzeh@gmail.com',email_verified:false}),'unassigned_storage_race','poster-owner-unverified.jpg','storage_owner_email'));
 await assertSucceeds(upload(env.authenticatedContext('storage_owner_email',{email:'kiahzeh@gmail.com',email_verified:true}),'unassigned_storage_race','poster-owner-email.jpg','storage_owner_email'));
});
test('highlight asset uploads enforce highlights.manage permission and owner path',async()=>{
 await assertFails(uploadBytes(ref(env.authenticatedContext('storage_owner').storage(),'highlight-assets/storage_owner/hl_1/primary.jpg'),image,{contentType:'image/jpeg'}));
 await assertSucceeds(uploadBytes(ref(env.authenticatedContext('storage_superadmin').storage(),'highlight-assets/storage_superadmin/hl_1/primary.jpg'),image,{contentType:'image/jpeg'}));
 await assertFails(uploadBytes(ref(env.authenticatedContext('storage_superadmin').storage(),'highlight-assets/someone_else/hl_1/primary.jpg'),image,{contentType:'image/jpeg'}));
});
test('SVG and executable file types are rejected across image and font storage paths',async()=>{
 const svgBytes=new Uint8Array(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'));
 await assertFails(uploadBytes(ref(env.authenticatedContext('storage_owner').storage(),'race-assets/storage_owner/storage_race/xss.svg'),svgBytes,{contentType:'image/svg+xml'}));
 await assertFails(uploadBytes(ref(env.authenticatedContext('storage_superadmin').storage(),'highlight-assets/storage_superadmin/hl_1/xss.svg'),svgBytes,{contentType:'image/svg+xml'}));
 await assertSucceeds(uploadBytes(ref(env.authenticatedContext('storage_superadmin').storage(),'race-bib-fonts/storage_superadmin/custom.woff2'),image,{contentType:'font/woff2'}));
 await assertFails(uploadBytes(ref(env.authenticatedContext('storage_superadmin').storage(),'race-bib-fonts/storage_superadmin/evil.html'),svgBytes,{contentType:'text/html'}));
});
test('route-private blocks anonymous writes and cross-owner access while route-published enforces scope and safe contentType',async()=>{
 const htmlBytes=new Uint8Array(Buffer.from('<html><script>alert(1)</script></html>'));
 await assertFails(uploadBytes(ref(env.unauthenticatedContext().storage(),'route-private/storage_owner/preset_1/course.gpx'),image,{contentType:'application/gpx+xml'}));
 await assertSucceeds(uploadBytes(ref(env.authenticatedContext('storage_owner').storage(),'route-private/storage_owner/preset_1/course.gpx'),image,{contentType:'application/gpx+xml'}));
 await assertFails(uploadBytes(ref(env.authenticatedContext('storage_owner').storage(),'route-private/storage_owner/preset_1/fake.json'),htmlBytes,{contentType:'text/html'}));
 await assertFails(uploadBytes(ref(env.authenticatedContext('storage_owner').storage(),'route-private/other_owner/preset_1/course.gpx'),image,{contentType:'application/gpx+xml'}));
 await assertSucceeds(uploadBytes(ref(env.authenticatedContext('storage_owner').storage(),'route-published/pub_storage_1/manifest.json'),image,{contentType:'application/json'}));
 await assertFails(uploadBytes(ref(env.authenticatedContext('storage_owner').storage(),'route-published/pub_storage_other/manifest.json'),image,{contentType:'application/json'}));
 await assertFails(uploadBytes(ref(env.authenticatedContext('storage_owner').storage(),'route-published/pub_storage_missing/manifest.json'),image,{contentType:'application/json'}));
 await assertFails(uploadBytes(ref(env.authenticatedContext('storage_owner').storage(),'route-published/pub_storage_1/xss.json'),htmlBytes,{contentType:'text/html'}));
});
test('materialized permissions allow delegated runner highlight uploads while explicit overrides deny',async()=>{
 await env.withSecurityRulesDisabled(async ctx=>{
  await setDoc(doc(ctx.firestore(),'users','storage_runner'),{uid:'storage_runner',role:'runner',approved:true});
  await setDoc(doc(ctx.firestore(),'userAccess','storage_runner'),{status:'active',scope:'owned-assigned',raceIds:[],overrides:{'highlights.view':true,'highlights.manage':true},permissions:{'highlights.view':true,'highlights.manage':true}});
 });
 await assertSucceeds(uploadBytes(ref(env.authenticatedContext('storage_runner').storage(),'highlight-assets/storage_runner/hl_run/portrait.jpg'),image,{contentType:'image/jpeg'}));
 await env.withSecurityRulesDisabled(ctx=>setDoc(doc(ctx.firestore(),'userAccess','storage_runner'),{status:'active',scope:'owned-assigned',raceIds:[],overrides:{'highlights.view':true,'highlights.manage':false},permissions:{'highlights.view':true,'highlights.manage':true}}));
 await assertFails(uploadBytes(ref(env.authenticatedContext('storage_runner').storage(),'highlight-assets/storage_runner/hl_run/blocked.jpg'),image,{contentType:'image/jpeg'}));
});
test('run-tracks enforces owner JSON < 5MB, personal.record permission, and blocks SVG/HTML/cross-owner access',async()=>{
 await env.withSecurityRulesDisabled(async ctx=>{
  const root=ctx.firestore();
  await setDoc(doc(root,'users','track_runner'),{uid:'track_runner',role:'runner',approved:true});
  await setDoc(doc(root,'users','track_other'),{uid:'track_other',role:'runner',approved:true});
  await setDoc(doc(root,'users','track_unapproved_org'),{uid:'track_unapproved_org',role:'organizer',approved:false});
  await setDoc(doc(root,'users','track_admin'),{uid:'track_admin',role:'admin',approved:true});
 });
 const jsonBytes=new Uint8Array(Buffer.from(JSON.stringify([{lat:14.55,lon:121.05,timestampMs:1764000000000}])));
 const svgBytes=new Uint8Array(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'));
 const htmlBytes=new Uint8Array(Buffer.from('<html><script>alert(1)</script></html>'));
 await assertFails(uploadBytes(ref(env.unauthenticatedContext().storage(),'run-tracks/track_runner/run_1.json'),jsonBytes,{contentType:'application/json'}));
 await assertSucceeds(uploadBytes(ref(env.authenticatedContext('track_runner').storage(),'run-tracks/track_runner/run_1.json'),jsonBytes,{contentType:'application/json'}));
 await assertSucceeds(getBytes(ref(env.authenticatedContext('track_runner').storage(),'run-tracks/track_runner/run_1.json')));
 await assertSucceeds(uploadBytes(ref(env.authenticatedContext('track_unapproved_org').storage(),'run-tracks/track_unapproved_org/run_org_1.json'),jsonBytes,{contentType:'application/json'}));
 await assertFails(uploadBytes(ref(env.authenticatedContext('track_admin').storage(),'run-tracks/track_admin/run_admin_1.json'),jsonBytes,{contentType:'application/json'}));
 await assertFails(uploadBytes(ref(env.authenticatedContext('track_runner').storage(),'run-tracks/track_runner/xss.svg'),svgBytes,{contentType:'image/svg+xml'}));
 await assertFails(uploadBytes(ref(env.authenticatedContext('track_runner').storage(),'run-tracks/track_runner/evil.html'),htmlBytes,{contentType:'text/html'}));
 await assertFails(uploadBytes(ref(env.authenticatedContext('track_runner').storage(),'run-tracks/track_runner/run_bad_ct.json'),htmlBytes,{contentType:'text/html'}));
 await assertFails(uploadBytes(ref(env.authenticatedContext('track_runner').storage(),'run-tracks/track_runner/too_big.json'),new Uint8Array(5*1024*1024),{contentType:'application/json'}));
 await assertFails(uploadBytes(ref(env.authenticatedContext('track_other').storage(),'run-tracks/track_runner/run_2.json'),jsonBytes,{contentType:'application/json'}));
 await assertFails(getBytes(ref(env.authenticatedContext('track_other').storage(),'run-tracks/track_runner/run_1.json')));
 await assertFails(deleteObject(ref(env.authenticatedContext('track_other').storage(),'run-tracks/track_runner/run_1.json')));
 await assertSucceeds(deleteObject(ref(env.authenticatedContext('storage_superadmin').storage(),'run-tracks/track_runner/run_1.json')));
 await env.withSecurityRulesDisabled(ctx=>setDoc(doc(ctx.firestore(),'userAccess','track_runner'),{status:'active',scope:'owned-assigned',raceIds:[],overrides:{'personal.record':false}}));
 await assertFails(uploadBytes(ref(env.authenticatedContext('track_runner').storage(),'run-tracks/track_runner/run_blocked.json'),jsonBytes,{contentType:'application/json'}));
});
