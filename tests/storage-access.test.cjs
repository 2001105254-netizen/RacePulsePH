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
test('badge-assets allows admin and superadmin raster uploads under 2MB and blocks organizer, runner, SVG, and 2MB+ files',async()=>{
 await env.withSecurityRulesDisabled(async ctx=>{
  const root=ctx.firestore();
  await setDoc(doc(root,'users','badge_admin'),{uid:'badge_admin',role:'admin',approved:true});
  await setDoc(doc(root,'users','badge_admin_other'),{uid:'badge_admin_other',role:'admin',approved:true});
  await setDoc(doc(root,'users','badge_organizer'),{uid:'badge_organizer',role:'organizer',approved:true});
  await setDoc(doc(root,'users','badge_runner'),{uid:'badge_runner',role:'runner',approved:true});
 });
 const svgBytes=new Uint8Array(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'));
 const tooBigBytes=new Uint8Array(2*1024*1024);
 await assertFails(uploadBytes(ref(env.unauthenticatedContext().storage(),'badge-assets/badge_admin/b_1/crest.png'),image,{contentType:'image/png'}));
 await assertFails(uploadBytes(ref(env.authenticatedContext('badge_organizer').storage(),'badge-assets/badge_organizer/b_1/crest.png'),image,{contentType:'image/png'}));
 await assertFails(uploadBytes(ref(env.authenticatedContext('badge_runner').storage(),'badge-assets/badge_runner/b_1/crest.png'),image,{contentType:'image/png'}));
 await assertSucceeds(uploadBytes(ref(env.authenticatedContext('badge_admin').storage(),'badge-assets/badge_admin/b_1/crest.png'),image,{contentType:'image/png'}));
 await assertSucceeds(uploadBytes(ref(env.authenticatedContext('badge_admin').storage(),'badge-assets/badge_admin/b_1/crest.webp'),image,{contentType:'image/webp'}));
 await assertSucceeds(uploadBytes(ref(env.authenticatedContext('storage_superadmin').storage(),'badge-assets/storage_superadmin/b_super/crest.avif'),image,{contentType:'image/avif'}));
 await assertSucceeds(getBytes(ref(env.unauthenticatedContext().storage(),'badge-assets/badge_admin/b_1/crest.png')));
 await assertFails(uploadBytes(ref(env.authenticatedContext('badge_admin').storage(),'badge-assets/badge_admin/b_1/xss.svg'),svgBytes,{contentType:'image/svg+xml'}));
 await assertFails(uploadBytes(ref(env.authenticatedContext('badge_admin').storage(),'badge-assets/badge_admin/b_1/huge.png'),tooBigBytes,{contentType:'image/png'}));
 await assertFails(uploadBytes(ref(env.authenticatedContext('badge_admin').storage(),'badge-assets/badge_admin_other/b_1/hijack.png'),image,{contentType:'image/png'}));
 await assertFails(deleteObject(ref(env.authenticatedContext('badge_admin_other').storage(),'badge-assets/badge_admin/b_1/crest.png')));
 await assertSucceeds(deleteObject(ref(env.authenticatedContext('storage_superadmin').storage(),'badge-assets/badge_admin/b_1/crest.png')));
 await env.withSecurityRulesDisabled(async ctx=>{
  const root=ctx.firestore();
  await setDoc(doc(root,'users','badge_org_granted'),{uid:'badge_org_granted',role:'organizer',approved:true});
  await setDoc(doc(root,'userAccess','badge_org_granted'),{status:'active',scope:'all',raceIds:[],overrides:{'badges.view':true,'badges.manage':true}});
  await setDoc(doc(root,'users','badge_org_pending_granted'),{uid:'badge_org_pending_granted',role:'organizer',approved:false});
  await setDoc(doc(root,'userAccess','badge_org_pending_granted'),{status:'active',scope:'all',raceIds:[],overrides:{'badges.view':true,'badges.manage':true}});
  await setDoc(doc(root,'users','badge_org_manage_only'),{uid:'badge_org_manage_only',role:'organizer',approved:true});
  await setDoc(doc(root,'userAccess','badge_org_manage_only'),{status:'active',scope:'all',raceIds:[],overrides:{'badges.manage':true}});
  await setDoc(doc(root,'users','badge_admin_no_view'),{uid:'badge_admin_no_view',role:'admin',approved:true});
  await setDoc(doc(root,'userAccess','badge_admin_no_view'),{status:'active',scope:'all',raceIds:[],overrides:{'badges.view':false}});
  await setDoc(doc(root,'users','badge_admin_no_manage'),{uid:'badge_admin_no_manage',role:'admin',approved:true});
  await setDoc(doc(root,'userAccess','badge_admin_no_manage'),{status:'active',scope:'all',raceIds:[],overrides:{'badges.manage':false}});
  await setDoc(doc(root,'users','badge_admin_suspended'),{uid:'badge_admin_suspended',role:'admin',approved:true});
  await setDoc(doc(root,'userAccess','badge_admin_suspended'),{status:'suspended',scope:'all',raceIds:[],overrides:{}});
  await setDoc(doc(root,'users','badge_admin_removed'),{uid:'badge_admin_removed',role:'admin',approved:true,accessRemoved:true});
 });
 await assertSucceeds(uploadBytes(ref(env.authenticatedContext('badge_org_granted').storage(),'badge-assets/badge_org_granted/b_org/crest.png'),image,{contentType:'image/png'}));
 await assertFails(uploadBytes(ref(env.authenticatedContext('badge_org_pending_granted').storage(),'badge-assets/badge_org_pending_granted/b_org/crest.png'),image,{contentType:'image/png'}));
 await assertFails(uploadBytes(ref(env.authenticatedContext('badge_org_manage_only').storage(),'badge-assets/badge_org_manage_only/b_org/crest.png'),image,{contentType:'image/png'}));
 await assertFails(uploadBytes(ref(env.authenticatedContext('badge_admin_no_view').storage(),'badge-assets/badge_admin_no_view/b_1/crest.png'),image,{contentType:'image/png'}));
 await assertFails(uploadBytes(ref(env.authenticatedContext('badge_admin_no_manage').storage(),'badge-assets/badge_admin_no_manage/b_1/crest.png'),image,{contentType:'image/png'}));
 await assertFails(uploadBytes(ref(env.authenticatedContext('badge_admin_suspended').storage(),'badge-assets/badge_admin_suspended/b_1/crest.png'),image,{contentType:'image/png'}));
 await assertFails(uploadBytes(ref(env.authenticatedContext('badge_admin_removed').storage(),'badge-assets/badge_admin_removed/b_1/crest.png'),image,{contentType:'image/png'}));
});

test('club-assets allows clubs.manage raster uploads under 8MB and blocks organizer, runner, SVG, >=8MB, and cross-owner paths',async()=>{
 await env.withSecurityRulesDisabled(async ctx=>{
  const root=ctx.firestore();
  await setDoc(doc(root,'users','club_admin'),{uid:'club_admin',role:'admin',approved:true});
  await setDoc(doc(root,'users','club_org'),{uid:'club_org',role:'organizer',approved:true});
  await setDoc(doc(root,'users','club_runner'),{uid:'club_runner',role:'runner',approved:true});
  await setDoc(doc(root,'users','club_admin_no_manage'),{uid:'club_admin_no_manage',role:'admin',approved:true});
  await setDoc(doc(root,'userAccess','club_admin_no_manage'),{status:'active',scope:'all',raceIds:[],overrides:{'clubs.manage':false}});
 });
 const svgBytes=new Uint8Array(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'));
 const tooBigBytes=new Uint8Array(8*1024*1024);
 await assertFails(uploadBytes(ref(env.unauthenticatedContext().storage(),'club-assets/club_admin/bgc_crew/logo.png'),image,{contentType:'image/png'}));
 await assertFails(uploadBytes(ref(env.authenticatedContext('club_org').storage(),'club-assets/club_org/bgc_crew/logo.png'),image,{contentType:'image/png'}));
 await assertFails(uploadBytes(ref(env.authenticatedContext('club_runner').storage(),'club-assets/club_runner/bgc_crew/logo.png'),image,{contentType:'image/png'}));
 await assertFails(uploadBytes(ref(env.authenticatedContext('club_admin_no_manage').storage(),'club-assets/club_admin_no_manage/bgc_crew/logo.png'),image,{contentType:'image/png'}));
 await assertSucceeds(uploadBytes(ref(env.authenticatedContext('club_admin').storage(),'club-assets/club_admin/bgc_crew/logo.png'),image,{contentType:'image/png'}));
 await assertSucceeds(uploadBytes(ref(env.authenticatedContext('storage_superadmin').storage(),'club-assets/storage_superadmin/bgc_crew/cover.webp'),image,{contentType:'image/webp'}));
 await assertSucceeds(getBytes(ref(env.unauthenticatedContext().storage(),'club-assets/club_admin/bgc_crew/logo.png')));
 await assertFails(uploadBytes(ref(env.authenticatedContext('club_admin').storage(),'club-assets/club_admin/bgc_crew/xss.svg'),svgBytes,{contentType:'image/svg+xml'}));
 await assertFails(uploadBytes(ref(env.authenticatedContext('club_admin').storage(),'club-assets/club_admin/bgc_crew/huge.png'),tooBigBytes,{contentType:'image/png'}));
 await assertFails(uploadBytes(ref(env.authenticatedContext('club_admin').storage(),'club-assets/storage_superadmin/bgc_crew/hijack.png'),image,{contentType:'image/png'}));
});

test('social-media restricts direct Storage reads to owner/superadmin and enforces raster <8MB or video <30MB with personal.social',async()=>{
 await env.withSecurityRulesDisabled(async ctx=>{
  const root=ctx.firestore();
  await setDoc(doc(root,'users','social_owner'),{uid:'social_owner',role:'runner',approved:true});
  await setDoc(doc(root,'users','social_peer'),{uid:'social_peer',role:'runner',approved:true});
  await setDoc(doc(root,'users','social_admin'),{uid:'social_admin',role:'admin',approved:true});
  await setDoc(doc(root,'users','social_denied'),{uid:'social_denied',role:'runner',approved:true});
  await setDoc(doc(root,'userAccess','social_denied'),{status:'active',scope:'owned-assigned',raceIds:[],overrides:{'personal.social':false}});
 });
 const svgBytes=new Uint8Array(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'));
 const videoBytes=new Uint8Array([0,0,0,24,102,116,121,112]);
 await assertSucceeds(uploadBytes(ref(env.authenticatedContext('social_owner').storage(),'social-media/social_owner/post_1/photo.png'),image,{contentType:'image/png'}));
 await assertSucceeds(uploadBytes(ref(env.authenticatedContext('social_owner').storage(),'social-media/social_owner/post_1/clip.mp4'),videoBytes,{contentType:'video/mp4'}));
 await assertSucceeds(getBytes(ref(env.authenticatedContext('social_owner').storage(),'social-media/social_owner/post_1/photo.png')));
 await assertSucceeds(getBytes(ref(env.authenticatedContext('storage_superadmin').storage(),'social-media/social_owner/post_1/photo.png')));
 await assertFails(getBytes(ref(env.unauthenticatedContext().storage(),'social-media/social_owner/post_1/photo.png')));
 await assertFails(getBytes(ref(env.authenticatedContext('social_peer').storage(),'social-media/social_owner/post_1/photo.png')));
 await assertFails(uploadBytes(ref(env.authenticatedContext('social_admin').storage(),'social-media/social_admin/post_1/photo.png'),image,{contentType:'image/png'}));
 await assertFails(uploadBytes(ref(env.authenticatedContext('social_denied').storage(),'social-media/social_denied/post_1/photo.png'),image,{contentType:'image/png'}));
 await assertFails(uploadBytes(ref(env.authenticatedContext('social_owner').storage(),'social-media/social_owner/post_1/xss.svg'),svgBytes,{contentType:'image/svg+xml'}));
 await assertFails(uploadBytes(ref(env.authenticatedContext('social_owner').storage(),'social-media/social_owner/post_1/big.png'),new Uint8Array(8*1024*1024),{contentType:'image/png'}));
 await assertFails(uploadBytes(ref(env.authenticatedContext('social_owner').storage(),'social-media/social_owner/post_1/big.mp4'),new Uint8Array(30*1024*1024),{contentType:'video/mp4'}));
 await assertFails(uploadBytes(ref(env.authenticatedContext('social_peer').storage(),'social-media/social_owner/post_1/hijack.png'),image,{contentType:'image/png'}));
});

test('chat-media enforces conversation membership, personal.inbox, raster <8MB, and private Storage reads',async()=>{
 await env.withSecurityRulesDisabled(async ctx=>{
  const root=ctx.firestore();
  await setDoc(doc(root,'users','chat_a'),{uid:'chat_a',role:'runner',approved:true});
  await setDoc(doc(root,'users','chat_b'),{uid:'chat_b',role:'runner',approved:true});
  await setDoc(doc(root,'users','chat_outsider'),{uid:'chat_outsider',role:'runner',approved:true});
  await setDoc(doc(root,'conversations','dm_chat_a_chat_b'),{conversationId:'dm_chat_a_chat_b',type:'dm',status:'active',members:['chat_a','chat_b']});
  await setDoc(doc(root,'conversations','dm_chat_a_chat_outsider'),{conversationId:'dm_chat_a_chat_outsider',type:'dm',status:'request_pending',members:['chat_a','chat_outsider']});
  await setDoc(doc(root,'conversations','club_manila_run'),{conversationId:'club_manila_run',type:'club',status:'active',clubId:'manila_run',members:[]});
  await setDoc(doc(root,'clubMembers','manila_run_chat_a'),{id:'manila_run_chat_a',clubId:'manila_run',uid:'chat_a',status:'active',role:'member'});
  await setDoc(doc(root,'clubMembers','manila_run_chat_outsider'),{id:'manila_run_chat_outsider',clubId:'manila_run',uid:'chat_outsider',status:'pending',role:'member'});
 });
 const svgBytes=new Uint8Array(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'));
 await assertSucceeds(uploadBytes(ref(env.authenticatedContext('chat_a').storage(),'chat-media/dm_chat_a_chat_b/chat_a/photo.png'),image,{contentType:'image/png'}));
 await assertSucceeds(uploadBytes(ref(env.authenticatedContext('chat_a').storage(),'chat-media/club_manila_run/chat_a/photo.webp'),image,{contentType:'image/webp'}));
 await assertSucceeds(getBytes(ref(env.authenticatedContext('chat_a').storage(),'chat-media/dm_chat_a_chat_b/chat_a/photo.png')));
 await assertFails(getBytes(ref(env.authenticatedContext('chat_b').storage(),'chat-media/dm_chat_a_chat_b/chat_a/photo.png')));
 await assertFails(uploadBytes(ref(env.authenticatedContext('chat_outsider').storage(),'chat-media/dm_chat_a_chat_b/chat_outsider/intrude.png'),image,{contentType:'image/png'}));
 await assertFails(uploadBytes(ref(env.authenticatedContext('chat_a').storage(),'chat-media/dm_chat_a_chat_outsider/chat_a/pending.png'),image,{contentType:'image/png'}));
 await assertFails(uploadBytes(ref(env.authenticatedContext('chat_outsider').storage(),'chat-media/club_manila_run/chat_outsider/pending.png'),image,{contentType:'image/png'}));
 await assertFails(uploadBytes(ref(env.authenticatedContext('chat_a').storage(),'chat-media/dm_chat_a_chat_b/chat_a/clip.mp4'),image,{contentType:'video/mp4'}));
 await assertFails(uploadBytes(ref(env.authenticatedContext('chat_a').storage(),'chat-media/dm_chat_a_chat_b/chat_a/xss.svg'),svgBytes,{contentType:'image/svg+xml'}));
 await assertFails(uploadBytes(ref(env.authenticatedContext('chat_a').storage(),'chat-media/dm_chat_a_chat_b/chat_a/huge.png'),new Uint8Array(8*1024*1024),{contentType:'image/png'}));
});
