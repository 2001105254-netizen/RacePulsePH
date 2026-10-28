// Uses the user's existing Firebase CLI management connection; never writes credentials to files.
const path=require('path'),fs=require('fs');
const policy=require('../functions/access-policy');
async function main(){
 const db=await require('./firebase-management.cjs').connect(),users=await db.collection('users').get(),states=await db.collection('userAccess').get(),removed=await db.collection('removedAccounts').get();
 const current=new Map(states.docs.map(d=>[d.id,d.data()])),tombstones=new Set(removed.docs.map(d=>d.id));
 const members=users.docs.filter(d=>d.data().role==='superadmin'&&current.get(d.id)?.status!=='suspended'&&!tombstones.has(d.id)).map(d=>d.id);
 if(!members.length)throw Error('No active Super Admin found; migration stopped.');
 const pending=users.docs.filter(d=>!current.has(d.id) || !current.get(d.id).permissions);
 for(const d of users.docs)if(!policy.roles.includes(d.data().role))throw Error(`Unknown role for ${d.id}.`);
 console.log(JSON.stringify({users:users.size,existingAccess:states.size,backfill:pending.length,activeSuperAdmins:members.length,mode:process.argv.includes('--apply')?'apply':'dry-run'}));
 if(process.argv.includes('--apply')){
  for(const d of pending){await db.runTransaction(async tx=>{const ref=db.doc(`userAccess/${d.id}`),latest=await tx.get(ref);const state=policy.accessFor(d.data(),latest.data());if(tombstones.has(d.id))state.status='suspended';state.permissions=Object.fromEntries(policy.keys.map(key=>[key,policy.can(d.data(),state,key)]));tx.set(ref,{...state,updatedBy:latest.data()?.updatedBy||'migration-v1',updatedAt:latest.data()?.updatedAt||new Date().toISOString()});});}
  await db.runTransaction(async tx=>{const ref=db.doc('accessSystem/authority'),rollout=db.doc('accessSystem/rollout');const [old,flag]=await Promise.all([tx.get(ref),tx.get(rollout)]);if(!old.exists)tx.create(ref,{members});if(!flag.exists)tx.create(rollout,{enforcementReady:false,version:1});});
 }
 if(process.argv.includes('--activate')){
  if(!process.argv.includes('--apply'))throw Error('Activation requires --apply.');
  const evidence=JSON.parse(fs.readFileSync('output/rbac-verification.json','utf8'));
  if(!evidence.passed||Date.now()-Date.parse(evidence.at)>86400000||evidence.sourceHash!==require('./verification-hash.cjs').sourceHash())throw Error('Fresh verification evidence matching the current sources is required.');
  await db.doc('accessSystem/rollout').set({enforcementReady:true,version:1,activatedAt:new Date().toISOString()});console.log('Access editing activated.');
 }
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
