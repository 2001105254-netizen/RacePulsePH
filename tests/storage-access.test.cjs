const {test,before,after}=require('node:test');
const fs=require('node:fs');
const {initializeTestEnvironment,assertSucceeds,assertFails}=require('@firebase/rules-unit-testing');
const {doc,setDoc}=require('firebase/firestore');
const {ref,uploadBytes}=require('firebase/storage');
let env;
before(async()=>{
 env=await initializeTestEnvironment({projectId:'demo-racepulse-rbac',firestore:{host:'127.0.0.1',port:8080},storage:{host:'127.0.0.1',port:9199,rules:fs.readFileSync('storage.rules','utf8')}});
 await env.withSecurityRulesDisabled(async ctx=>{
  await setDoc(doc(ctx.firestore(),'users','storage_owner'),{uid:'storage_owner',role:'organizer',approved:true});
  await setDoc(doc(ctx.firestore(),'races','storage_race'),{createdBy:'storage_owner'});
  await setDoc(doc(ctx.firestore(),'races','unassigned_storage_race'),{createdBy:'other'});
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
