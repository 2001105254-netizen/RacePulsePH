// Explicit live smoke test: creates an isolated Runner fixture and removes it in finally.
const path=require('path'),crypto=require('crypto');
async function main(){
 if(process.env.RBAC_SMOKE_LIVE!=='1')throw Error('Set RBAC_SMOKE_LIVE=1 to authorize the temporary live fixture.');
 const root=process.env.FIREBASE_TOOLS_PATH,cli=require(path.join(root,'lib/auth.js')),account=cli.getGlobalDefaultAccount();
 const admin=require('../functions/node_modules/firebase-admin');
 const app=admin.initializeApp({projectId:'racepulseph',credential:{getAccessToken:async()=>{const value=await cli.getAccessToken(account.tokens.refresh_token,[]);return {access_token:value.access_token,expires_in:3600};}}},'rbac-live-smoke');
 const manager=await require('./firebase-management.cjs').connect();
 const email=`rbac-verification-${crypto.randomBytes(8).toString('hex')}@example.invalid`,password=crypto.randomBytes(32).toString('base64url');
 let uid,cleaned=false;
 try{
  const user=await app.auth().createUser({email,password,emailVerified:true,displayName:'RBAC verification fixture'});uid=user.uid;
  await manager.doc(`users/${uid}`).set({uid,email,displayName:'RBAC verification fixture',role:'runner',approved:true,createdAt:new Date().toISOString()});
  const signed=await fetch('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=AIzaSyBDJINSNOpvVOtichvPKWIKixWvxa5pI9s',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password,returnSecureToken:true})});
  const identity=await signed.json();if(!signed.ok||!identity.idToken)throw Error('Fixture sign-in failed.');
  const headers={Authorization:`Bearer ${identity.idToken}`,'Content-Type':'application/json',Origin:'http://localhost:3000'};
  const endpoint='https://asia-southeast1-racepulseph.cloudfunctions.net/accessApi';
  const response=await fetch(endpoint+'/session',{method:'POST',headers,body:'{}'}),session=await response.json();
  if(!response.ok||session.role!=='runner'||session.permissions['users.view']!==false||session.permissions['personal.register']!==true)throw Error('Live preset/session check failed.');
  const save=await fetch(endpoint+'/save',{method:'POST',headers,body:JSON.stringify({uid,role:'superadmin'})});if(save.status!==403)throw Error('Protected management endpoint did not reject Runner.');
  const base='https://firestore.googleapis.com/v1/projects/racepulseph/databases/(default)/documents';
  const own=await fetch(`${base}/users/${uid}`,{headers});if(!own.ok)throw Error('Signed-in profile read failed.');
  const forged=await fetch(`${base}/userAccess/${uid}?updateMask.fieldPaths=overrides`,{method:'PATCH',headers,body:JSON.stringify({fields:{overrides:{mapValue:{fields:{'users.view':{booleanValue:true}}}}}})});if(forged.status!==403)throw Error('Direct access-field mutation was not rejected.');
  console.log(JSON.stringify({signedInProfile:true,runnerPreset:true,managementDenied:true,directEscalationDenied:true}));
 }finally{
  if(uid){await manager.doc(`userAccess/${uid}`).delete();await manager.doc(`users/${uid}`).delete();await app.auth().deleteUser(uid);cleaned=true;}
  await app.delete();console.log(JSON.stringify({temporaryFixtureRemoved:cleaned}));
 }
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
