const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

const source=fs.readFileSync(path.join(__dirname,'..','assets','arena-model-probe.inject.js'),'utf8');
const RUN='run_example01';
const OTHER='run_other02';
const eventsUrl=`https://api.trigger.dev/api/v1/runs/${RUN}/events`;
const ev=(message,runId=RUN,model=null)=>({runId,message,...(model?{
  style:{accessory:{items:[{icon:'tabler-cube',text:model}]}}
}: {})});
const trace=(...events)=>({events});
const turn2=()=>[ev('chat turn 1'),ev('ai.streamText.doStream',RUN,'old-turn-model'),
  ev('chat turn 2'),ev('ai.streamText.doStream',RUN,'claude-opus-5-5')];
const example=()=>trace(...turn2(),ev('model.resample.attempt_failed'),
  ev('model.resample.switched'),ev('ai.streamText.doStream',RUN,'gpt-5.5-2026-04-23'),
  ev('model.resample.committed'));
const flush=()=>new Promise(resolve=>setImmediate(resolve));

function setup(fetcher=async()=>new Response('{}')){
  const consoleStub={log(){},warn(){},error(){}};
  const window={fetch:fetcher};
  const location={href:'https://arena.ai/agent/11111111-1111-1111-1111-111111111111',
    origin:'https://arena.ai',pathname:'/agent/11111111-1111-1111-1111-111111111111'};
  const context=vm.createContext({window,location,console:consoleStub,fetch:fetcher,URL,Response,Request,
    TextDecoder,TextEncoder,atob,btoa,AbortController,performance,setTimeout,clearTimeout});
  const marker='try { __req("main"); }';
  assert.ok(source.includes(marker));
  vm.runInContext(source.replace(marker,'try { globalThis.probeRequire = __req; }'),context);
  return {context,window,location,req:context.probeRequire};
}
const plain=x=>JSON.parse(JSON.stringify(x));
function token(location){
  const payload={pub:true,iss:'https://id.trigger.dev',aud:'https://api.trigger.dev',
    exp:Math.floor(Date.now()/1000)+3600,scopes:['read:runs:'+RUN,'read:sessions:'+location.pathname.split('/').pop()]};
  return [Buffer.from('{"alg":"none"}').toString('base64url'),Buffer.from(JSON.stringify(payload)).toString('base64url'),'signature'].join('.');
}

test('exact Trigger.dev events URL and explicit switch in latest turn are required',()=>{
  const w=setup().req('route-watch');
  assert.equal(w.runIdFromEventsUrl(eventsUrl+'?x=1'),RUN);
  for(const url of ['https://api.trigger.dev.evil/api/v1/runs/'+RUN+'/events',
    'https://arena.ai/api/v1/runs/'+RUN+'/events',eventsUrl+'/more',
    'https://api.trigger.dev/api/v1/runs/'+RUN+'/spans/aabbccddeeff0011'])
    assert.equal(w.runIdFromEventsUrl(url),null);
  assert.equal(w.summarize(trace(...turn2(),ev('model.resample.attempt_failed')),RUN).phase,'attempt-failed');
  assert.equal(w.summarize(trace(...turn2(),ev('model.resample.attempt_failed')),RUN).to,null);
  assert.equal(w.summarize(trace(...turn2(),ev('model.resample.switched')),RUN).to,null);
  assert.deepEqual(plain(w.summarize(example(),RUN)),{turn:2,phase:'committed',
    from:'claude-opus-5-5',to:'gpt-5.5-2026-04-23'});
  assert.equal(w.summarize(trace(ev('chat turn 1'),ev('model.resample.switched'),ev('chat turn 2')) ,RUN),null);
  assert.equal(w.summarize(trace(ev('chat turn 2'),ev('ai.streamText.doStream',RUN,'a'),
    ev('model.resample.switched',OTHER),ev('ai.streamText.doStream',RUN,'b')),RUN),null);
  assert.equal(w.summarize(trace(...turn2(),ev('model.resample.switched'),
    ev('ai.streamText.doStream',RUN,'CLAUDE-OPUS-5-5-vertex')),RUN).to,null);
  assert.equal(w.summarize(trace(...turn2(),ev('disable-opus'),ev('toolu_vrtx_123'),
    ev('ai.streamText.doStream',RUN,'gpt-5.5')),RUN),null);
});

test('page polling yields an immediate scoped signal without an extra request or raw trace in the event',async()=>{
  let requests=0;
  const {req,window,location}=setup(async()=>{requests++;return new Response(JSON.stringify(example()),
    {headers:{'content-type':'application/json'}});});
  const bus=req('interceptor').BUS,run=req('runmodel'),signals=[];
  bus.on(evt=>{if(evt.kind==='route-trace')run.observeRouteSnapshot(evt.data.runId,evt.data.snapshot);
    if(evt.kind==='route-switch')signals.push(evt.data);});
  assert.equal(run.acceptToken('public-access-token',token(location)),true);
  req('interceptor').installFetchHook();
  const response=await window.fetch(eventsUrl);
  assert.equal((await response.json()).events.length,8,'clone must not consume page response');
  await flush();
  assert.equal(requests,1);
  assert.deepEqual(plain(signals[0]),{runId:RUN,turn:2,phase:'committed',
    from:'claude-opus-5-5',to:'gpt-5.5-2026-04-23',generation:0});
  assert.ok(!JSON.stringify(run.state()).includes('signature'));
  await window.fetch(eventsUrl);await flush();
  assert.equal(signals.length,1,'same snapshot should be deduplicated');
  run.reset();await window.fetch(eventsUrl);await flush();
  assert.equal(signals.length,1,'no active token means no signal');
});

test('stale phase, old turn, other run and navigation are rejected',()=>{
  const {req,location}=setup();const bus=req('interceptor').BUS,run=req('runmodel');
  const received=[];bus.on(evt=>{if(evt.kind==='route-switch')received.push(evt.data);});
  assert.equal(run.observeRouteSnapshot(RUN,{turn:2,phase:'switched',from:'a',to:'b'}),false);
  run.acceptToken('public-access-token',token(location));
  assert.equal(run.observeRouteSnapshot(OTHER,{turn:2,phase:'switched',from:'a',to:'b'}),false);
  assert.equal(run.observeRouteSnapshot(RUN,{turn:2,phase:'switched',from:'a',to:'b'}),true);
  assert.equal(run.observeRouteSnapshot(RUN,{turn:2,phase:'attempt-failed',from:'a',to:null}),false);
  assert.equal(run.observeRouteSnapshot(RUN,{turn:2,phase:'committed',from:'a',to:'b'}),true);
  assert.equal(run.observeRouteSnapshot(RUN,{turn:2,phase:'switched',from:'a',to:'b'}),false);
  location.pathname='/agent/someone-else';
  assert.equal(run.observeRouteSnapshot(RUN,{turn:3,phase:'switched',from:'a',to:'c'}),false);
  location.pathname='/agent/11111111-1111-1111-1111-111111111111';
  run.beginRunTurn('/api/chat');
  assert.equal(run.observeRouteSnapshot(RUN,{turn:2,phase:'switched',from:'a',to:'c'}),false);
  assert.equal(received.length,2);
});

test('the existing authorized trace read emits a switch before any span-detail read',async()=>{
  let requests=0;
  const {req,location}=setup(async(url)=>{
    requests++;
    assert.equal(url,eventsUrl);
    return new Response(JSON.stringify(example()),{headers:{'content-type':'application/json'}});
  });
  const bus=req('interceptor').BUS,run=req('runmodel'),signals=[];
  bus.on(evt=>{if(evt.kind==='route-switch')signals.push(evt.data);});
  run.acceptToken('public-access-token',token(location));
  const result=await run.fetchRunModels();
  assert.equal(result.ok,true);
  assert.equal(result.name,'gpt-5.5-2026-04-23');
  assert.equal(signals.length,1);
  assert.equal(signals[0].phase,'committed');
  assert.equal(requests,1,'no new network request introduced by route recognition');
});

test('active trace fallback retains its original eight-second initial wait',()=>{
  const {req,context,location}=setup();const waits=[];
  context.setTimeout=(_fn,ms)=>{waits.push(ms);return 1;};
  const run=req('runmodel');run.startAutoResolve();
  run.acceptToken('public-access-token',token(location));
  assert.equal(waits[0],8000);
  assert.match(source,/startAutoResolve\(\{ initialDelayMs: 8000,/);
});

test('a late page response cannot cross to a new generation',async()=>{
  let resolveFetch;
  const {req,window,location}=setup(()=>new Promise(resolve=>{resolveFetch=resolve;}));
  const bus=req('interceptor').BUS,run=req('runmodel'),signals=[];
  bus.on(evt=>{if(evt.kind==='route-trace')run.observeRouteSnapshot(evt.data.runId,evt.data.snapshot);
    if(evt.kind==='route-switch')signals.push(evt.data);});
  run.acceptToken('public-access-token',token(location));
  req('interceptor').installFetchHook();
  const pending=window.fetch(eventsUrl);
  bus.generation++;
  resolveFetch(new Response(JSON.stringify(example())));
  await pending;await flush();
  assert.equal(signals.length,0);
});

test('same-turn confirmed switch uses the existing safe, once-per-generation stop action',()=>{
  const {req,context,location}=setup();let clicks=0;
  const conversationId=location.pathname.split('/').pop();
  const button={textContent:'Stop generating',disabled:false,getAttribute:()=>null,
    getClientRects:()=>[{}],closest:()=>null,click(){clicks++;}};
  const main={querySelectorAll:()=>[button],getClientRects:()=>[{}]};
  context.document={querySelectorAll:selector=>selector==='main'?[main]:[button],body:main,
    addEventListener(){}};
  context.getComputedStyle=()=>({visibility:'visible'});
  const notifier=req('notifier');notifier.setModelDriftStopEnabled(true);
  assert.equal(notifier.checkRouteSwitch('claude-opus-5-5','CLAUDE-OPUS-5-5-vertex',{generation:4,conversationId}),null);
  assert.equal(notifier.checkRouteSwitch('claude-opus-5-5','gpt-5.5-2026-04-23',{generation:4,conversationId}).stopped,true);
  notifier.checkRouteSwitch('claude-opus-5-5','gpt-5.5-2026-04-23',{generation:4,conversationId});
  assert.equal(clicks,1);
  button.textContent='Send message';
  assert.equal(notifier.checkRouteSwitch('a','b',{generation:5,conversationId}).stopped,false);
  assert.equal(clicks,1);
});
