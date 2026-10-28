const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process');let fixture,child,directory;
const port=31743;
const operator={uid:'operator',permissions:{'timing.scan':true,'timing.view':true,'engraving.view':true,'engraving.create':true,'engraving.status':true},scope:'selected',allowedRaceIds:['race_a']};
const runner={uid:'runner',permissions:{'personal.engraving':true},scope:'owned-assigned',allowedRaceIds:[]};
before(async()=>{
 directory=fs.mkdtempSync(path.join(os.tmpdir(),'racepulse-lan-test-'));
 fixture=http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');const session=req.headers.authorization==='Bearer operator'?operator:req.headers.authorization==='Bearer runner'?runner:null;res.statusCode=session?200:401;res.end(JSON.stringify(session||{error:'Invalid session'}));});
 await new Promise(resolve=>fixture.listen(0,'127.0.0.1',resolve));
 child=spawn(process.execPath,['dist/server.cjs'],{env:{...process.env,NODE_ENV:'production',PORT:String(port),RACEPULSE_BRIDGE_KEY:'test-pairing-key-012345678901234567890',RACEPULSE_BRIDGE_RACE_ID:'race_a',RACEPULSE_DATA_DIR:directory,RACEPULSE_ACCESS_API_URL:`http://127.0.0.1:${fixture.address().port}`},stdio:['ignore','pipe','pipe']});
 let serverOutput='';child.stdout.on('data',chunk=>{serverOutput+=chunk;});child.stderr.on('data',chunk=>{serverOutput+=chunk;});
 const deadline=Date.now()+30000;while(Date.now()<deadline){try{const res=await fetch(`http://127.0.0.1:${port}/api/orders`);if(res.status===401)return;}catch{}await new Promise(r=>setTimeout(r,100));}throw Error('Test server did not start. '+serverOutput);
});
after(async()=>{child?.kill();await new Promise(resolve=>fixture.close(resolve));});
const request=(route,method='GET',token,body)=>fetch(`http://127.0.0.1:${port}/api/${route}`,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{})});
test('actual local HTTP routes deny anonymous reads and unpaired bridge input',async()=>{
 assert.equal((await request('orders')).status,401);assert.equal((await request('rfid-events','POST',undefined,{epc:'DEADBEEF'})).status,401);
});
test('actual local HTTP routes enforce record owner, scope and status authority',async()=>{
 const order={id:'test_order',ownerUid:'runner',runnerName:'Runner',bibNumber:'5-001',distance:'5K',finishingTime:'00:20:00',status:'queued',createdAt:'2026-10-28',updatedAt:'2026-10-28'};
 assert.equal((await request('orders','POST','runner',order)).status,200);
 assert.equal((await request('orders','POST','runner',{...order,status:'completed'})).status,403);
 assert.equal((await request('orders/reset','POST','operator',{})).status,403);
 const read={id:'scan',raceId:'race_b',recordedBy:'operator',bibNumber:'5-001',checkpointId:'start',timestamp:new Date().toISOString()};
 assert.equal((await request('chip-reads','POST','operator',read)).status,403);
 assert.equal((await request('chip-reads','POST','operator',{...read,raceId:'race_a'})).status,200);
 const records=await(await request('orders','GET','runner')).json();assert.equal(records.orders.length,1);assert.equal(records.orders[0].ownerUid,'runner');
});

test('bridge replay retains original receipt time, metadata and all burst events',async()=>{
 const post=body=>fetch('http://127.0.0.1:'+port+'/api/rfid-events',{method:'POST',headers:{'Content-Type':'application/json','X-RacePulse-Bridge-Key':'test-pairing-key-012345678901234567890'},body:JSON.stringify(body)});
 const event={id:'burst_0',epc:'DEADBEEF',antenna:1,timestamp:'2026-10-28T00:00:00.1234567Z',readerSequence:1,monotonicTicks:'1234567',monotonicFrequency:'10000000'};
 const first=await(await post(event)).json();
 for(let i=1;i<505;i++)assert.equal((await post({...event,id:'burst_'+i,readerSequence:i+1})).status,201);
 const replay=await(await post({...event,timestamp:'2026-10-28T01:00:00Z'})).json();
 assert.equal(replay.event.receivedAt,first.event.receivedAt);
 assert.equal(replay.event.timestamp,event.timestamp);
 const payload=await(await request('rfid-events?raceId=race_a','GET','operator')).json();
 assert.equal(payload.events.length,505);
 assert.equal(payload.events.find(e=>e.id==='burst_0').monotonicTicks,event.monotonicTicks);
});
