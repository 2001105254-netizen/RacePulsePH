const {spawnSync}=require('child_process'),fs=require('fs');
const {sourceHash}=require('./verification-hash.cjs');
require('./build-access-deploy.cjs');
const checks=[['npm',['run','lint']],['npm',['run','build']],['node',['--test','tests/access-policy.test.cjs','tests/lan-access.test.cjs','tests/account-client.test.cjs','tests/account-security.test.cjs','tests/timing-sequence.test.cjs']],['node',['--test','tests/lan-http.test.cjs']],['npx',['--yes','firebase-tools','emulators:exec','--only','firestore,storage','--project','demo-racepulse-rbac','node --test tests/access-rules.test.cjs tests/access-service.test.cjs tests/storage-access.test.cjs']]];
const before=sourceHash();
for(const [command,args]of checks){const windows=process.platform==='win32';const invocation=windows?[command,...args.map(arg=>'"'+arg+'"')].join(' '):command;const result=spawnSync(invocation,windows?[]:args,{stdio:'inherit',shell:windows,timeout:600000});if(result.status!==0){process.exitCode=1;break;}}
if(!process.exitCode){if(before!==sourceHash())throw Error('Sources changed during verification. Rerun verification.');fs.mkdirSync('output',{recursive:true});fs.writeFileSync('output/rbac-verification.json',JSON.stringify({passed:true,at:new Date().toISOString(),sourceHash:before,checks:checks.map(([command,args])=>[command,...args].join(' '))},null,2)+'\n');console.log('RBAC verification passed.');}
