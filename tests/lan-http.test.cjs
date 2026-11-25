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
 const deadline=Date.now()+90000;while(Date.now()<deadline){if(child.exitCode!==null)throw Error('Test server exited ('+child.exitCode+'). '+serverOutput);try{const res=await fetch(`http://127.0.0.1:${port}/api/orders`);if(res.status===401)return;}catch{}await new Promise(r=>setTimeout(r,100));}throw Error('Test server did not start. '+serverOutput);
});
after(async()=>{child?.kill();await new Promise(resolve=>fixture.close(resolve));});
const request=(route,method='GET',token,body)=>fetch(`http://127.0.0.1:${port}/api/${route}`,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{})});
test('actual local HTTP routes deny anonymous reads and unpaired bridge input',async()=>{
 const health=await(await request('health')).json();assert.equal(health.status,'ok');assert.equal(health.bridgeConfigured,true);
 assert.equal((await request('orders')).status,401);assert.equal((await request('rfid-events','POST',undefined,{epc:'DEADBEEF'})).status,401);
});
test('actual local HTTP routes enforce record owner, scope and status authority',async()=>{
 const order={id:'test_order',ownerUid:'runner',runnerName:'Runner',bibNumber:'5-001',distance:'5K',finishingTime:'00:20:00',status:'queued',createdAt:'2026-10-28',updatedAt:'2026-10-28'};
 assert.equal((await request('orders','POST','runner',{...order,id:'__proto__'})).status,400);
 assert.equal((await request('orders','POST','runner',order)).status,200);
 assert.equal((await request('orders','POST','runner',{...order,status:'completed'})).status,403);
 assert.equal((await request('orders/reset','POST','operator',{})).status,403);
 const read={id:'scan',raceId:'race_b',recordedBy:'operator',bibNumber:'5-001',checkpointId:'start',timestamp:new Date().toISOString()};
 assert.equal((await request('chip-reads','POST','operator',read)).status,403);
 assert.equal((await request('chip-reads','POST','operator',{...read,raceId:'race_a'})).status,200);
 const records=await(await request('orders','GET','runner')).json();assert.equal(records.orders.length,1);assert.equal(records.orders[0].ownerUid,'runner');assert.equal(records.orders[0].finishingTime,'00:20:0000000');
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
test('local HTTP enforces security headers, CORS allowlist, plain JSON bodies, and reset trailing slash blocks',async()=>{
 const healthRes=await request('health');
 assert.equal(healthRes.headers.get('x-content-type-options'),'nosniff');
 assert.equal(healthRes.headers.get('x-frame-options'),'DENY');
 assert.equal(healthRes.headers.get('cache-control'),'no-store');
 assert.equal(healthRes.headers.get('x-powered-by'),null);

 const evilCors=await fetch(`http://127.0.0.1:${port}/api/health`,{headers:{Origin:'https://evil.example'}});
 assert.equal(evilCors.headers.get('access-control-allow-origin'),null);
 const evilPreflight=await fetch(`http://127.0.0.1:${port}/api/orders`,{method:'OPTIONS',headers:{Origin:'https://evil.example'}});
 assert.equal(evilPreflight.status,403);
 const lanCors=await fetch(`http://127.0.0.1:${port}/api/health`,{headers:{Origin:'http://192.168.1.50:3000'}});
 assert.equal(lanCors.headers.get('access-control-allow-origin'),'http://192.168.1.50:3000');

 const arrayBody=await fetch(`http://127.0.0.1:${port}/api/orders`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer operator'},body:JSON.stringify([1,2,3])});
 assert.equal(arrayBody.status,400);

 const resetSlash=await request('orders/reset/','POST','operator',{id:'evil_reset',runnerName:'Test',bibNumber:'5-1',status:'queued'});
 assert.equal(resetSlash.status,403);
 assert.equal(lanCors.headers.get('access-control-expose-headers'),'Retry-After, X-Request-Id');
 assert.match(lanCors.headers.get('access-control-allow-headers')||'',/X-Firebase-AppCheck/);

 // Repeated invalid bridge credentials trigger 429 + Retry-After to stop brute-force/DDoS.
 let saw429=false;
 for(let i=0;i<20;i+=1){
  const badBridge=await fetch(`http://127.0.0.1:${port}/api/rfid-events`,{method:'POST',headers:{'Content-Type':'application/json','X-RacePulse-Bridge-Key':'wrong-key'},body:JSON.stringify({id:'bad_'+i,epc:'DEADBEEF',antenna:1,timestamp:new Date().toISOString()})});
  if(badBridge.status===429){
   saw429=true;
   assert.ok(Number(badBridge.headers.get('retry-after'))>=1);
   break;
  }
 }
 assert.equal(saw429,true);
});

test('local HTTP provides /api/readyz, X-Request-Id tracing, ?raceId=&limit= filtering, and gzip compression', async () => {
 const readyRes = await fetch(`http://127.0.0.1:${port}/api/readyz`, {
  headers: { 'X-Request-Id': 'req-trace-123' },
 });
 assert.equal(readyRes.status, 200);
 assert.equal(readyRes.headers.get('x-request-id'), 'req-trace-123');
 const readyBody = await readyRes.json();
 assert.equal(readyBody.ready, true);

 const autoTraceRes = await request('health');
 assert.ok((autoTraceRes.headers.get('x-request-id') || '').length >= 8);

 // Seed two reads in race_a so we can test limit=1 and >1KiB gzip response.
 for (let i = 0; i < 6; i += 1) {
  const res = await request('chip-reads', 'POST', 'operator', {
   id: `filter_read_${i}`,
   raceId: 'race_a',
   recordedBy: 'operator',
   bibNumber: `5-${String(i).padStart(3, '0')}`,
   checkpointId: 'finish',
   timestamp: '2026-10-28T00:30:00.1234567Z',
  });
  assert.equal(res.status, 200);
 }

 const limitedRes = await fetch(`http://127.0.0.1:${port}/api/chip-reads?raceId=race_a&limit=2`, {
  headers: { Authorization: 'Bearer operator', 'Accept-Encoding': 'gzip' },
 });
 assert.equal(limitedRes.status, 200);
 const limitedJson = await limitedRes.json();
 assert.equal(limitedJson.chipReads.length, 2);
 assert.ok(limitedJson.chipReads.every((r) => r.raceId === 'race_a'));

 const uncompressedAll = await fetch(`http://127.0.0.1:${port}/api/chip-reads?raceId=race_a`, {
  headers: { Authorization: 'Bearer operator', 'Accept-Encoding': 'gzip' },
 });
 assert.equal(uncompressedAll.status, 200);
 const allJson = await uncompressedAll.json();
 assert.ok(allJson.chipReads.length >= 6);
});

test('local HTTP returns 503 without partial memory corruption when persistence fails', async () => {
 const failDir = fs.mkdtempSync(path.join(os.tmpdir(), 'racepulse-lan-fail-'));
 fs.mkdirSync(path.join(failDir, 'local_chip_reads.json'));
 const failPort = 31744;
 const failChild = spawn(process.execPath, ['dist/server.cjs'], {
  env: {
   ...process.env,
   NODE_ENV: 'production',
   PORT: String(failPort),
   RACEPULSE_BRIDGE_KEY: 'test-pairing-key-012345678901234567890',
   RACEPULSE_BRIDGE_RACE_ID: 'race_a',
   RACEPULSE_DATA_DIR: failDir,
   RACEPULSE_ACCESS_API_URL: `http://127.0.0.1:${fixture.address().port}`,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
 });
 try {
  const deadline = Date.now() + 20000;
  let started = false;
  while (Date.now() < deadline) {
   try {
    const r = await fetch(`http://127.0.0.1:${failPort}/api/health`);
    if (r.status === 200) { started = true; break; }
   } catch {}
   await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal(started, true);

  const persistFailRes = await fetch(`http://127.0.0.1:${failPort}/api/chip-reads`, {
   method: 'POST',
   headers: { 'Content-Type': 'application/json', Authorization: 'Bearer operator' },
   body: JSON.stringify({
    id: 'scan_should_fail',
    raceId: 'race_a',
    recordedBy: 'operator',
    bibNumber: '5-999',
    checkpointId: 'finish',
    timestamp: '2026-10-28T00:30:00Z',
   }),
  });
  assert.equal(persistFailRes.status, 503);

  const listAfterFail = await fetch(`http://127.0.0.1:${failPort}/api/chip-reads?raceId=race_a`, {
   headers: { Authorization: 'Bearer operator' },
  });
  const afterData = await listAfterFail.json();
  assert.equal(afterData.chipReads.some((r) => r.id === 'scan_should_fail'), false);
 } finally {
  failChild.kill();
  fs.rmSync(failDir, { recursive: true, force: true });
 }
});

test('local HTTP enforces Zero Trust headers, rejects evil-origin mutations, and accepts HMAC bridge signatures', async () => {
 const { signHmacBridgePayload } = require('../functions/request-guard');
 const healthRes = await request('health');
 assert.match(healthRes.headers.get('permissions-policy') || '', /camera=\(self\)/);
 assert.equal(healthRes.headers.get('cross-origin-opener-policy'), 'same-origin-allow-popups');
 assert.equal(healthRes.headers.get('x-xss-protection'), '0');
 assert.equal(healthRes.headers.get('content-security-policy'), "default-src 'none'; frame-ancestors 'none'");

 const evilPost = await fetch(`http://127.0.0.1:${port}/api/orders`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example', Authorization: 'Bearer runner' },
  body: JSON.stringify({ id: 'evil_origin_1', ownerUid: 'runner', runnerName: 'Runner', bibNumber: '5-001', status: 'queued' }),
 });
 assert.equal(evilPost.status, 403);

 const bridgeSecret = 'test-pairing-key-012345678901234567890';
 const ts = Math.floor(Date.now() / 1000);
 const nonce = 'hmac_nonce_0123456789abcdef';
 const hmacPayload = JSON.stringify({
  id: 'hmac_ev_1',
  epc: 'CAFEBABE1234',
  antenna: 2,
  timestamp: new Date().toISOString(),
 });
 const signature = signHmacBridgePayload({ secret: bridgeSecret, rawBody: hmacPayload, timestampSec: ts, nonce });

 const hmacOk = await fetch(`http://127.0.0.1:${port}/api/rfid-events`, {
  method: 'POST',
  headers: {
   'Content-Type': 'application/json',
   'X-RacePulse-Bridge-Timestamp': String(ts),
   'X-RacePulse-Bridge-Nonce': nonce,
   'X-RacePulse-Bridge-Signature': signature,
  },
  body: hmacPayload,
 });
 assert.equal(hmacOk.status, 201);
});

test('local HTTP rejects legacy key when RACEPULSE_BRIDGE_REQUIRE_HMAC=true and blocks HMAC tampering/replays with 401', async () => {
 const strictDir = fs.mkdtempSync(path.join(os.tmpdir(), 'racepulse-lan-hmac-'));
 const strictPort = 31745;
 const bridgeSecret = 'test-pairing-key-012345678901234567890';
 const strictChild = spawn(process.execPath, ['dist/server.cjs'], {
  env: {
   ...process.env,
   NODE_ENV: 'production',
   PORT: String(strictPort),
   RACEPULSE_BRIDGE_KEY: bridgeSecret,
   RACEPULSE_BRIDGE_RACE_ID: 'race_a',
   RACEPULSE_BRIDGE_REQUIRE_HMAC: 'true',
   RACEPULSE_DATA_DIR: strictDir,
   RACEPULSE_ACCESS_API_URL: `http://127.0.0.1:${fixture.address().port}`,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
 });
 try {
  const deadline = Date.now() + 20000;
  let started = false;
  while (Date.now() < deadline) {
   try {
    const r = await fetch(`http://127.0.0.1:${strictPort}/api/health`);
    if (r.status === 200) { started = true; break; }
   } catch {}
   await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal(started, true);

  const legacyRes = await fetch(`http://127.0.0.1:${strictPort}/api/rfid-events`, {
   method: 'POST',
   headers: { 'Content-Type': 'application/json', 'X-RacePulse-Bridge-Key': bridgeSecret },
   body: JSON.stringify({ id: 'leg_1', epc: 'DEADBEEF', antenna: 1, timestamp: new Date().toISOString() }),
  });
  assert.equal(legacyRes.status, 401);

  const { signHmacBridgePayload } = require('../functions/request-guard');
  const ts = Math.floor(Date.now() / 1000);
  const nonce = 'strict_hmac_nonce_0123456789';
  const body = JSON.stringify({ id: 'strict_1', epc: 'DEADBEEF', antenna: 1, timestamp: new Date().toISOString() });
  const sig = signHmacBridgePayload({ secret: bridgeSecret, rawBody: body, timestampSec: ts, nonce });
  const hmacRes = await fetch(`http://127.0.0.1:${strictPort}/api/rfid-events`, {
   method: 'POST',
   headers: {
    'Content-Type': 'application/json',
    'X-RacePulse-Bridge-Timestamp': String(ts),
    'X-RacePulse-Bridge-Nonce': nonce,
    'X-RacePulse-Bridge-Signature': sig,
   },
   body,
  });
  assert.equal(hmacRes.status, 201);

  // Replaying the exact same nonce must be rejected with 401.
  const hmacReplay = await fetch(`http://127.0.0.1:${strictPort}/api/rfid-events`, {
   method: 'POST',
   headers: {
    'Content-Type': 'application/json',
    'X-RacePulse-Bridge-Timestamp': String(ts),
    'X-RacePulse-Bridge-Nonce': nonce,
    'X-RacePulse-Bridge-Signature': sig,
   },
   body,
  });
  assert.equal(hmacReplay.status, 401);

  // Tampered body with fresh nonce must be rejected with 401.
  const hmacTampered = await fetch(`http://127.0.0.1:${strictPort}/api/rfid-events`, {
   method: 'POST',
   headers: {
    'Content-Type': 'application/json',
    'X-RacePulse-Bridge-Timestamp': String(ts),
    'X-RacePulse-Bridge-Nonce': 'strict_hmac_fresh_9876543210',
    'X-RacePulse-Bridge-Signature': sig,
   },
   body: body.replace('DEADBEEF', 'CAFEBABE'),
  });
  assert.equal(hmacTampered.status, 401);
 } finally {
  strictChild.kill();
  fs.rmSync(strictDir, { recursive: true, force: true });
 }
});
