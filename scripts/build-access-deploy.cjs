const fs=require('fs');
fs.mkdirSync('functions/rbac',{recursive:true});
for(const name of ['access-api.js','access-service.js','access-policy.js'])fs.copyFileSync(`functions/${name}`,`functions/rbac/${name}`);
fs.writeFileSync('functions/rbac/index.js',"// Generated deployment entrypoint; canonical source lives in functions/access-*.js.\nconst admin = require('firebase-admin');\nadmin.initializeApp();\nexports.accessApi = require('./access-api').accessApi;\n");
fs.writeFileSync('functions/rbac/package.json',JSON.stringify({name:'racepulse-rbac',private:true,main:'index.js',engines:{node:'22'},dependencies:{'firebase-admin':'^13.0.1','firebase-functions':'^6.0.1'}},null,2)+'\n');
