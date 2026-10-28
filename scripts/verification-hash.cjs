const fs=require('fs'),path=require('path'),crypto=require('crypto');
function sourceHash(){
 const hash=crypto.createHash('sha256');
 function add(file){hash.update(file.replaceAll('\\','/'));hash.update(fs.readFileSync(file));}
 function walk(dir){for(const item of fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){if(item.name==='node_modules')continue;const file=path.join(dir,item.name);if(item.isDirectory())walk(file);else if(/\.(tsx?|js|cjs|json|rules)$/.test(file))add(file);}}
 for(const dir of ['src','functions','scripts','tests'])walk(dir);
 for(const file of ['firestore.rules','storage.rules','firebase.json','firestore.indexes.json','server.ts','package.json','package-lock.json'])add(file);
 return hash.digest('hex');
}
module.exports={sourceHash};
