const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const target=process.env.PROBE_FILE || path.join(__dirname,'..','assets','arena-model-probe.inject.js');
const source=fs.readFileSync(target,'utf8');
const session='11111111-1111-1111-1111-111111111111';
const url='https://arena.ai/agent/'+session;
function load(extra={}) {
 const context=vm.createContext({console,performance,TextDecoder,TextEncoder,atob,btoa,AbortController,URL,setTimeout,clearTimeout,location:{origin:'https://arena.ai',pathname:'/agent/'+session},...extra});
 const marker='try { __req("main"); }';
 assert.ok(source.includes(marker));
 vm.runInContext(source.replace(marker,'try { globalThis.probeRequire = __req; }'),context);
 return {req:context.probeRequire,context};
}
const plain=x=>JSON.parse(JSON.stringify(x));
function fixture() {
 const runId='run_test';
 const events=[{runId,message:'chat turn 1'},...['ai.streamText.doStream','token.usage.recorded','spend.recorded'].map((message,i)=>({runId,message,spanId:String(i+1).repeat(16),isPartial:false,style:{accessory:{items:i===0?[{icon:'cube',text:'demo'}]:[]}}}))];
 const props=[{'ai.model.id':'demo','ai.usage.inputTokens':20,'ai.usage.outputTokens':10,'ai.usage.reasoningTokens':4,'ai.settings.reasoningEffort':'high'}, {modelName:'demo-high',inputTokens:20,outputTokens:10,reasoningTokens:4,messageId:'msg1'}, {modelName:'demo-high',messageId:'msg1',costUsd:0.1}];
 const details=events.slice(1).map((e,i)=>({...e,properties:props[i]}));
 return {runId,trace:{events},details};
}
function payload(overrides={}){return {pub:true,iss:'https://id.trigger.dev',aud:'https://api.trigger.dev',exp:Math.floor(Date.now()/1000)+3600,scopes:['read:runs:run_test','read:sessions:'+session],...overrides};}
function jwt(p){return [Buffer.from('{"alg":"none"}').toString('base64url'),Buffer.from(JSON.stringify(p)).toString('base64url'),'signature'].join('.');}
test('9.17.9 distinguishes request, response, route and protocol providers',()=>{
 const {req}=load(),a=req('agent-detail'),f=fixture();
 Object.assign(f.details[0].properties,{'ai.telemetry.metadata.modelProvider':'vertex','ai.model.provider':'google','ai.response.model':'demo-response','ai.telemetry.metadata.apiModelName':'demo'});
 f.details[1].properties.provider='vertex';
 const spans=a.selectDetailSpans(f.trace,f.runId).selected.map((e,i)=>a.parseDetailSpan(f.details[i],e,f.runId));
 const summary=req('trace-summary').latestTraceSummary({spans});
 assert.equal(summary.modelProvider,'vertex');assert.equal(summary.protocolProvider,'google');assert.equal(summary.responseModel,'demo-response');assert.equal(summary.routeConflict,false);
 assert.equal(req('trace-summary').desktopFacts(null,[],[],summary).collectionStatus,'collected');
 f.details[1].properties.provider='openrouter';
 const conflict=req('trace-summary').latestTraceSummary({spans:a.selectDetailSpans(f.trace,f.runId).selected.map((e,i)=>a.parseDetailSpan(f.details[i],e,f.runId))});
 assert.equal(conflict.modelProvider,null);assert.equal(conflict.routeConflict,true);assert.equal(req('trace-summary').desktopFacts(null,[],[],conflict).collectionStatus,'conflict');
});
test('ambiguous trace preserves call list without guessing effort',()=>{
 const summary=load().req('trace-summary');const s=summary.latestTraceSummary({checkedAt:'2026-09-17',spans:[1,2].map(i=>({spanId:String(i).repeat(16),turn:1,kind:'stream',partial:false,values:{requestModel:'demo-'+i}}))});
 assert.equal(s.calls.length,2);assert.equal(s.checkedAt,'2026-09-17');assert.equal(s.internalTier,null);assert.equal(summary.desktopFacts(null,[],[],s).collectionStatus,'multi');
});
test('latest trace turn ignores older turns and other run IDs',()=>{
 const run=load().req('runmodel'),trace={events:[{runId:'run_test',message:'chat turn 1'},{runId:'run_test',message:'old'},{runId:'other',message:'chat turn 99'},{runId:'run_test',message:'chat turn 2'},{runId:'run_test',message:'new'}]};
 const result=run.newestTraceTurn(trace,'run_test');assert.equal(result.turn,2);assert.deepEqual(plain(result.events.map(e=>e.message)),['chat turn 2','new']);
});
test('same-session next turn rejects prior trace and accepts newer turn; navigation discards token',async()=>{
 const f=fixture();let calls=0;
 const {req,context}=load({fetch:async u=>{calls++;return {ok:true,status:200,text:async()=>JSON.stringify(u.endsWith('/events')?f.trace:f.details.find(x=>u.endsWith(x.spanId)))};}});
 const run=req('runmodel');run.acceptToken('public-access-token',jwt(payload()));await run.fetchRunModels();
 assert.equal(run.state().lastSeenTurn,1);run.beginRunTurn('/api/chat');assert.equal(run.state().tokenPresent,true);assert.equal(run.state().minTurn,1);
 assert.equal((await run.fetchRunModels()).reason,'awaiting-current-turn');assert.equal(run.state().automaticTrace,null);
 f.trace.events[0].message='chat turn 2';assert.equal((await run.fetchRunModels()).ok,true);assert.equal(run.state().lastSeenTurn,2);
 context.location.pathname='/agent/22222222-2222-2222-2222-222222222222';run.beginRunTurn('/api/chat');assert.equal(run.state().tokenPresent,false);
});
test('HTTP 429 backoff survives reset and prevents another request',async()=>{
 let calls=0;const run=load({fetch:async()=>{calls++;return {ok:false,status:429};}}).req('runmodel');
 const token=jwt(payload());run.acceptToken('public-access-token',token);assert.equal((await run.fetchRunModels()).reason,'http-429');
 run.reset();run.acceptToken('public-access-token',token);assert.equal((await run.fetchRunModels()).reason,'http-429');assert.equal(calls,1);assert.equal(run.state().collectionStatus,'rate-limited');
});
test('final detail refresh works after ordinary collection is complete and emits HUD update',async()=>{
 const f=fixture();let updates=0,calls=0;
 const {req}=load({fetch:async u=>{calls++;return {ok:true,status:200,text:async()=>JSON.stringify(u.endsWith('/events')?f.trace:f.details.find(x=>u.endsWith(x.spanId)))};}});
 req('interceptor').BUS.on(e=>{if(e.kind==='reasoning-detail')updates++;});
 const run=req('runmodel');run.acceptToken('public-access-token',jwt(payload()));await run.fetchRunModels();
 assert.equal((await run.fetchRunModels()).reason,'finished');assert.equal((await run.fetchRunModels({final:true})).ok,true);
 assert.equal(calls,8);assert.equal(updates,2);assert.ok(run.state().checkedAt);
});
const balanceSource=()=>fs.readFileSync(path.join(path.dirname(target),'ArenaBalance.js'),'utf8');
function balance(fetch,origin='https://arena.ai') {
 const jobs=new Map();let id=0;
 const context=vm.createContext({window:{},location:{origin},AbortController,fetch,setTimeout:(fn)=>{jobs.set(++id,fn);return id;},clearTimeout:i=>jobs.delete(i)});
 const action=vm.runInContext(balanceSource(),context);
 return {action,jobs};
}
const flush=()=>new Promise(r=>setImmediate(r));
test('balance fetch is same-origin and exposes only validated credit fields',async()=>{
 let calls=0;const b=balance(async(u,o)=>{calls++;assert.equal(u,'/api/billing/balance');assert.equal(o.credentials,'same-origin');assert.equal(o.redirect,'error');return {ok:true,status:200,headers:{get:()=> 'application/json'},json:async()=>({creditsRemaining:20,dailyFreeCredits:5,refreshedAt:'2026-09-17T00:00:00Z',secret:'PRIVATE'})};});
 assert.equal(b.action('start','one').status,'pending');await flush();const result=b.action('read','one');assert.equal(result.status,'ready');assert.equal(result.creditsRemaining,20);assert.ok(!JSON.stringify(result).includes('PRIVATE'));b.action('start','one');assert.equal(calls,1);assert.equal(b.jobs.size,0);
});
for(const [status,result] of [[401,'signed-out'],[403,'forbidden'],[429,'rate-limited'],[500,'server-error']])test(`balance handles HTTP ${status} without retry`,async()=>{
 let calls=0;const b=balance(async()=>{calls++;return {ok:false,status};});b.action('start','id');await flush();assert.equal(b.action('read','id').status,result);assert.equal(calls,1);
});
test('balance rejects a foreign origin without network access',()=>{
 let calls=0;const b=balance(async()=>{calls++;},'https://example.com');assert.equal(b.action('start','id').status,'unavailable');assert.equal(calls,0);
});
test('balance rejects malformed credit values',async()=>{
 const b=balance(async()=>({ok:true,status:200,headers:{get:()=> 'application/json'},json:async()=>({creditsRemaining:-1,dailyFreeCredits:5})}));b.action('start','id');await flush();assert.equal(b.action('read','id').status,'invalid');
});
test('balance timeout aborts pending fetch and late responses cannot overwrite it',async()=>{
 let resolve,signal;const b=balance((u,o)=>{signal=o.signal;return new Promise(r=>resolve=r);});b.action('start','id');for(const f of b.jobs.values())f();assert.equal(signal.aborted,true);assert.equal(b.action('read','id').status,'timeout');
 resolve({ok:true,status:200,headers:{get:()=> 'application/json'},json:async()=>({creditsRemaining:20,dailyFreeCredits:5})});await flush();assert.equal(b.action('read','id').status,'timeout');
});
